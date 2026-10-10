"""Exercise deployment control flow without Docker, network or a real database.

Run: python -m unittest discover -s deploy/tests -v
Windows: set DEPLOY_TEST_BASH to the Git Bash executable first.
"""

import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
BASH = os.environ.get("DEPLOY_TEST_BASH", "bash")
MOCK_DOCKER = r'''
import json, os, pathlib, sys
a = sys.argv[1:]
scenario = os.environ.get("SCENARIO", "success")
p = pathlib.Path("calls.log")
with p.open("a") as f: f.write(" ".join(a) + "\n")
values = dict(line.split("=", 1) for line in pathlib.Path("deploy/.env").read_text().splitlines()
              if "=" in line and not line.startswith("#"))
if a[0] == "info": sys.exit(0)
if a[0] == "ps":
    print("other-container" if scenario == "docker-conflict" else
          "current-container" if scenario == "upgrade" else "")
    sys.exit(0)
if a[0] == "inspect":
    print("running starting" if scenario == "timeout" else "running healthy")
    sys.exit(0)
if "config" in a and "--format" in a:
    print(json.dumps({"services": {"app": {"ports": [{"published": os.environ.get("APP_PORT", values["APP_PORT"]),
        "host_ip": "0.0.0.0"}]}}, "secrets": {"app_settings": {"file": "deploy/settings.toml"}}}))
elif "build" in a and scenario == "build-failure": sys.exit(42)
elif "run" in a and scenario == "db-failure" and "scripts/check_database.py" in a: sys.exit(43)
elif "up" in a: pathlib.Path("started").touch()
elif "ps" in a:
    print("current-container" if scenario == "upgrade" or pathlib.Path("started").exists() else "")
'''


class DeployTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / "deploy").mkdir()
        (self.root / "bin").mkdir()
        for name in ("deploy.sh", ".env.example", "settings.example.toml"):
            shutil.copyfile(ROOT / "deploy" / name, self.root / "deploy" / name)
        shutil.copyfile(ROOT / "compose.yaml", self.root / "compose.yaml")
        shutil.copyfile(self.root / "deploy/.env.example", self.root / "deploy/.env")
        (self.root / "deploy/settings.toml").write_text("# test sentinel\n", encoding="utf-8")
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        subprocess.run(["git", "-C", str(self.root), "-c", "user.name=Test", "-c",
                        "user.email=test@example.test", "commit", "--allow-empty", "-qm", "test"],
                       check=True)
        py = Path(sys.executable).as_posix()
        self.shim("python3", f'exec "{py}" "$@"')
        (self.root / "mock_docker.py").write_text(MOCK_DOCKER, encoding="utf-8")
        self.shim("docker", f'exec "{py}" mock_docker.py "$@"')
        # ss must return zero for the empty result as real ss does.
        self.shim("ss", 'if [ "${SCENARIO:-}" = port-conflict ]; then echo "LISTEN 0 128 0.0.0.0:8080"; fi')
        self.shim("curl", 'echo "$*" >> http.log; exit 0')

    def shim(self, name, body):
        path = self.root / "bin" / name
        path.write_text("#!/usr/bin/env bash\n" + body + "\n", encoding="utf-8", newline="\n")
        path.chmod(0o755)

    def run_deploy(self, scenario="success", args=(), extra_env=None):
        env = os.environ.copy()
        for key in ("APP_PORT", "APP_SETTINGS_SOURCE", "COMPOSE_FILE"):
            env.pop(key, None)
        env.update(SCENARIO=scenario, **(extra_env or {}))
        # Bash sets PATH so Git Bash and Linux both resolve the same shims.
        return subprocess.run(
            [BASH, "-c", 'export PATH="$PWD/bin:$PATH"; bash deploy/deploy.sh "$@"',
             "deploy-test", *args], cwd=self.root, env=env, text=True,
            encoding="utf-8", errors="replace", capture_output=True, timeout=30,
        )

    def calls(self):
        path = self.root / "calls.log"
        return path.read_text() if path.exists() else ""

    def test_success_and_port_persistence(self):
        result = self.run_deploy(args=("--port", "18080"), extra_env={"APP_PORT": "9000"})
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("[8/8] 完成", result.stdout)
        self.assertIn("APP_PORT=18080", (self.root / "deploy/.env").read_text())
        self.assertIn("127.0.0.1:18080/health", (self.root / "http.log").read_text())
        self.assertTrue(list((self.root / "logs/deploy").glob("*.log")))

    def test_host_port_conflict_stops_before_build(self):
        result = self.run_deploy("port-conflict", ("--port", "8080"))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("[3/8] 失败", result.stdout)
        self.assertNotIn("build --pull", self.calls())

    def test_other_container_port_conflict(self):
        result = self.run_deploy("docker-conflict")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("other-container", result.stdout + result.stderr)
        self.assertNotIn("build --pull", self.calls())

    def test_existing_project_port_allows_upgrade(self):
        result = self.run_deploy("upgrade")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("允许原地更新", result.stdout)

    def test_build_failure_preserves_exit_code(self):
        result = self.run_deploy("build-failure")
        self.assertEqual(result.returncode, 42, result.stdout + result.stderr)
        self.assertIn("[4/8] 失败", result.stdout)
        self.assertNotIn("up -d", self.calls())

    def test_database_failure_does_not_replace_old_app(self):
        result = self.run_deploy("db-failure")
        self.assertEqual(result.returncode, 43, result.stdout + result.stderr)
        self.assertIn("[5/8] 失败", result.stdout)
        self.assertNotIn("up -d", self.calls())

    def test_health_timeout_reports_stage(self):
        result = self.run_deploy("timeout", ("--wait", "1"))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("[7/8] 失败", result.stdout)
        self.assertFalse((self.root / "http.log").exists())

    def test_init_preserves_existing_secrets(self):
        result = self.run_deploy(args=("--init", "--port", "8088"))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual((self.root / "deploy/settings.toml").read_text(), "# test sentinel\n")
        self.assertEqual(self.calls(), "")

    def test_invalid_port(self):
        result = self.run_deploy(args=("--port", "65536"))
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.calls(), "")


if __name__ == "__main__":
    unittest.main()
