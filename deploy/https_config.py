"""Server-only certificate import and non-secret dotenv updates; stdlib only."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def read_env(root: Path) -> dict[str, str]:
    values = {}
    for line in (root / "deploy/.env").read_text(encoding="utf-8-sig").splitlines():
        match = re.match(r"^([A-Z_][A-Z0-9_]*)=(.*)$", line)
        if match:
            values[match[1]] = match[2].strip().strip("\"'")
    return values


def write_env(root: Path, updates: dict[str, str]) -> None:
    path = root / "deploy/.env"
    text = path.read_text(encoding="utf-8-sig")
    for key, value in updates.items():
        pattern = rf"^{key}=.*$"
        if re.search(pattern, text, flags=re.M):
            text = re.sub(pattern, lambda _: f"{key}={value}", text, flags=re.M)
        else:
            text = text.rstrip() + f"\n{key}={value}\n"
    with path.open("w", encoding="utf-8", newline="\n") as stream:
        stream.write(text)
    path.chmod(0o600)


def openssl(*args: str, data: bytes | None = None) -> bytes:
    result = subprocess.run(
        ["openssl", *args], input=data, capture_output=True, check=False
    )
    if result.returncode:
        # Never forward tool stderr that might include secret material.
        raise ValueError("证书校验失败：检查格式、有效期、域名、私钥密码和私钥匹配")
    return result.stdout


def check_certificate(cert: Path, key: Path, domain: str) -> None:
    if not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?", domain):
        raise ValueError("HTTPS_DOMAIN 格式无效")
    if not cert.is_file() or not key.is_file():
        raise ValueError("缺少 deploy/certs/fullchain.pem 或 private.key；先导入证书 ZIP")
    cert_bytes = cert.read_bytes()
    if cert_bytes.count(b"-----BEGIN CERTIFICATE-----") < 2:
        raise ValueError("请提供完整证书链，包含域名证书及中间 CA 证书")
    openssl("x509", "-in", str(cert), "-noout", "-checkend", "0")
    host_result = openssl("x509", "-in", str(cert), "-noout", "-checkhost", domain)
    if b"does NOT match" in host_result:
        raise ValueError("证书不覆盖 HTTPS_DOMAIN")
    dates = openssl("x509", "-in", str(cert), "-noout", "-dates").decode("ascii")
    not_before = next(line.split("=", 1)[1] for line in dates.splitlines() if line.startswith("notBefore="))
    start = datetime.strptime(not_before, "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)
    if start > datetime.now(timezone.utc):
        raise ValueError("证书尚未生效")
    cert_public = openssl("x509", "-in", str(cert), "-pubkey", "-noout")
    cert_der = openssl("pkey", "-pubin", "-outform", "DER", data=cert_public)
    key_der = openssl("pkey", "-in", str(key), "-passin", "pass:", "-pubout", "-outform", "DER")
    if cert_der != key_der:
        raise ValueError("证书与私钥不匹配")
    print(f"证书校验成功，域名：{domain}；{dates.strip()}")


def backup(root: Path) -> Path:
    path = root / "deploy/backups" / (datetime.now().strftime("https-%Y%m%d-%H%M%S-") + str(os.getpid()))
    path.mkdir(parents=True, mode=0o700)
    shutil.copy2(root / "deploy/.env", path / ".env")
    if (root / "deploy/certs").exists():
        shutil.copytree(root / "deploy/certs", path / "certs")
    print(f"配置和证书备份：{path}")
    return path


def import_archive(root: Path, archive: Path, domain: str) -> None:
    # Read only the two required files. Never extract ZIP paths onto the server.
    with zipfile.ZipFile(archive) as package:
        bundles = [info for info in package.infolist() if Path(info.filename).name.endswith("_bundle.pem")]
        keys = [info for info in package.infolist() if Path(info.filename).suffix == ".key"]
        if len(bundles) != 1 or len(keys) != 1:
            raise ValueError("ZIP 必须包含唯一的 *_bundle.pem 和 *.key")
        if any(info.file_size > 1024 * 1024 for info in (bundles[0], keys[0])):
            raise ValueError("证书文件大小异常")
        cert_data, key_data = package.read(bundles[0]), package.read(keys[0])
    with tempfile.TemporaryDirectory(prefix="shell-https-") as temporary:
        staging = Path(temporary)
        cert, key = staging / "fullchain.pem", staging / "private.key"
        cert.write_bytes(cert_data)
        key.write_bytes(key_data)
        key.chmod(0o600)
        check_certificate(cert, key, domain)
        backup(root)
        target = root / "deploy/certs"
        target.mkdir(mode=0o700, exist_ok=True)
        target.chmod(0o700)
        # Mount the directory, not individual files, so renewals/reloads see replacements.
        shutil.copyfile(cert, target / "fullchain.pem")
        shutil.copyfile(key, target / "private.key")
        (target / "fullchain.pem").chmod(0o644)
        (target / "private.key").chmod(0o600)
    print("证书已导入 deploy/certs；没有输出私钥")


def enable(root: Path) -> None:
    values = read_env(root)
    profiles = [item for item in values.get("COMPOSE_PROFILES", "").split(",") if item]
    if "https" not in profiles:
        profiles.append("https")
    # Retain the deployed image tag, APP_ENV, ownership and all business settings.
    write_env(root, {"COMPOSE_PROFILES": ",".join(profiles), "APP_BIND_ADDRESS": "127.0.0.1"})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("import", "check", "enable", "backup"))
    parser.add_argument("--zip", type=Path)
    parser.add_argument("--domain", default="resource.digitalshell.com.cn")
    args = parser.parse_args()
    if args.action == "import":
        if args.zip is None:
            parser.error("import requires --zip")
        import_archive(ROOT, args.zip, args.domain)
    elif args.action == "check":
        check_certificate(ROOT / "deploy/certs/fullchain.pem", ROOT / "deploy/certs/private.key", args.domain)
    elif args.action == "backup":
        backup(ROOT)
    else:
        enable(ROOT)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, zipfile.BadZipFile) as error:
        raise SystemExit(str(error)) from None
