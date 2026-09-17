import os
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]

# Tests use the committed, credential-free test profile and never a developer's
# local settings.toml or database.
os.environ["APP_ENV"] = "test"
os.environ["APP_SETTINGS_FILE"] = str(
    BACKEND_ROOT / "config" / "settings.example.toml"
)
