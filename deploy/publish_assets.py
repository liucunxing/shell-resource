"""Publish Vite's content-hashed files before the release's HTML becomes visible."""

import argparse
import filecmp
import os
from pathlib import Path
import shutil
import tempfile


def publish_assets(source: Path, destination: Path) -> None:
    files = sorted(path for path in source.rglob("*") if path.is_file())
    if not any(path.suffix == ".js" for path in files):
        raise ValueError(f"No frontend scripts in {source}")
    for asset in files:
        target = destination / asset.relative_to(source)
        target.parent.mkdir(parents=True, exist_ok=True)
        # A killed or overlapping release must never expose a partially copied chunk.
        if not target.exists():
            with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as tmp:
                temporary = Path(tmp.name)
            try:
                shutil.copyfile(asset, temporary)
                temporary.chmod(0o644)
                try:
                    os.link(temporary, target)
                    continue
                except FileExistsError:
                    pass
            finally:
                temporary.unlink(missing_ok=True)
        if not filecmp.cmp(asset, target, shallow=False):
            raise ValueError(f"Different contents for published asset {target.name}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, nargs="?", default=Path("/app/frontend/dist/assets"))
    publish_assets(parser.parse_args().source, Path("/published"))
