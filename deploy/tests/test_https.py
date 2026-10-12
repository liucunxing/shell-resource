"""Verify safe ZIP selection, backups and secret-preserving dotenv updates."""

import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile


SCRIPT = Path(__file__).resolve().parents[1] / "https_config.py"
SPEC = importlib.util.spec_from_file_location("https_config", SCRIPT)
https_config = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(https_config)


class HttpsConfigTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / "deploy").mkdir()
        self.original = (
            "IMAGE_TAG=known-deployed-release\nAPP_BIND_ADDRESS=0.0.0.0\n"
            "APP_PORT=18080\nAPP_ENV=development\nAPP_UID=1000\n"
            "VITE_YIWEN_IFRAME_URL=http://example.test:3052/\n"
        )
        (self.root / "deploy/.env").write_text(self.original)

    def make_zip(self, entries):
        archive = self.root / "certificate.zip"
        with zipfile.ZipFile(archive, "w") as package:
            for name, data in entries:
                package.writestr(name, data)
        return archive

    def test_enable_preserves_release_business_config_and_other_profiles(self):
        path = self.root / "deploy/.env"
        path.write_text(self.original + "COMPOSE_PROFILES=observability\n")
        https_config.enable(self.root)
        values = https_config.read_env(self.root)
        self.assertEqual(values["COMPOSE_PROFILES"], "observability,https")
        self.assertEqual(values["IMAGE_TAG"], "known-deployed-release")
        self.assertEqual(values["APP_PORT"], "18080")
        self.assertEqual(values["APP_BIND_ADDRESS"], "127.0.0.1")
        self.assertEqual(values["APP_ENV"], "development")
        self.assertEqual(values["APP_UID"], "1000")
        self.assertEqual(values["VITE_YIWEN_IFRAME_URL"], "http://example.test:3052/")
        https_config.enable(self.root)
        self.assertEqual(https_config.read_env(self.root)["COMPOSE_PROFILES"], "observability,https")

    def test_import_reads_only_expected_files_and_backs_up_old_certificates(self):
        target = self.root / "deploy/certs"
        target.mkdir()
        (target / "private.key").write_bytes(b"old-key")
        archive = self.make_zip([
            ("folder/example_bundle.pem", b"chain"),
            ("folder/example.key", b"key"),
            ("../../should-not-extract.txt", b"unexpected"),
        ])
        with patch.object(https_config, "check_certificate") as check:
            https_config.import_archive(self.root, archive, "resource.example.test")
        check.assert_called_once()
        self.assertEqual((target / "fullchain.pem").read_bytes(), b"chain")
        self.assertEqual((target / "private.key").read_bytes(), b"key")
        self.assertFalse((self.root / "should-not-extract.txt").exists())
        backups = list((self.root / "deploy/backups").iterdir())
        self.assertEqual(len(backups), 1)
        self.assertEqual((backups[0] / ".env").read_text(), self.original)
        self.assertEqual((backups[0] / "certs/private.key").read_bytes(), b"old-key")

    def test_failed_certificate_validation_does_not_install_or_change_env(self):
        archive = self.make_zip([("example_bundle.pem", b"bad-chain"), ("example.key", b"bad-key")])
        with patch.object(https_config, "check_certificate", side_effect=ValueError("invalid")):
            with self.assertRaises(ValueError):
                https_config.import_archive(self.root, archive, "resource.example.test")
        self.assertFalse((self.root / "deploy/certs").exists())
        self.assertEqual((self.root / "deploy/.env").read_text(), self.original)

    def test_rejects_ambiguous_archive(self):
        archive = self.make_zip([("a_bundle.pem", b"a"), ("b_bundle.pem", b"b"), ("a.key", b"key")])
        with self.assertRaises(ValueError):
            https_config.import_archive(self.root, archive, "resource.example.test")

    def test_rejects_oversized_archive_member(self):
        archive = self.make_zip([("a_bundle.pem", b"x" * (1024 * 1024 + 1)), ("a.key", b"key")])
        with self.assertRaises(ValueError):
            https_config.import_archive(self.root, archive, "resource.example.test")

    def test_rejects_invalid_domain_before_calling_openssl(self):
        with self.assertRaises(ValueError):
            https_config.check_certificate(Path("unused"), Path("unused"), "https://bad.test/")


if __name__ == "__main__":
    unittest.main()
