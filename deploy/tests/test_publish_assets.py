import concurrent.futures
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from deploy.publish_assets import publish_assets


class PublishedAssetsTests(unittest.TestCase):
    def test_upgrade_retry_and_rollback_keep_every_referenced_asset(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            archive = root / "published"
            for release in ("a", "b"):
                source = root / release
                source.mkdir()
                for suffix in ("js", "css"):
                    (source / f"editor-{release}.{suffix}").write_text(release)
                (source / "shared.js").write_text("shared")
            with concurrent.futures.ThreadPoolExecutor() as pool:
                list(pool.map(lambda r: publish_assets(root / r, archive), ("a", "b", "b", "a")))
            self.assertEqual(len(list(archive.iterdir())), 5)
            for release in ("a", "b"):
                for suffix in ("js", "css"):
                    self.assertEqual((archive / f"editor-{release}.{suffix}").read_text(), release)
            (root / "b/shared.js").write_text("other")
            with self.assertRaisesRegex(ValueError, "Different contents"):
                publish_assets(root / "b", archive)
            self.assertEqual((archive / "shared.js").read_text(), "shared")

    def test_incomplete_asset_can_be_retried(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source, archive = root / "source", root / "published"
            source.mkdir()
            (source / "editor.js").write_text("ok")
            with patch("deploy.publish_assets.shutil.copyfile", side_effect=OSError), self.assertRaises(OSError):
                publish_assets(source, archive)
            self.assertEqual(list(archive.iterdir()), [])
            publish_assets(source, archive)
            self.assertEqual((archive / "editor.js").read_text(), "ok")
