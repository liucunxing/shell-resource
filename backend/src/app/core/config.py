import os
import tomllib
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal, cast

from dotenv import dotenv_values
from pydantic import BaseModel, ConfigDict, Field, SecretStr

PROJECT_ROOT = Path(__file__).resolve().parents[3]
Environment = Literal["development", "test", "production"]
ENVIRONMENT_ALIASES: dict[str, Environment] = {
    "dev": "development",
    "development": "development",
    "test": "test",
    "prod": "production",
    "production": "production",
}


def _selected_environment() -> Environment:
    """Read the active profile from the process environment or local .env file."""
    root_env = dotenv_values(PROJECT_ROOT / ".env")
    raw_value = os.getenv("APP_ENV") or root_env.get("APP_ENV") or "development"
    normalized = ENVIRONMENT_ALIASES.get(str(raw_value).strip().lower())
    if normalized is None:
        allowed = ", ".join(ENVIRONMENT_ALIASES)
        raise ValueError(f"Unsupported APP_ENV={raw_value!r}; allowed values: {allowed}")
    return cast(Environment, normalized)


def _settings_file() -> Path:
    override = os.getenv("APP_SETTINGS_FILE")
    if override:
        path = Path(override)
        return path if path.is_absolute() else PROJECT_ROOT / path
    return PROJECT_ROOT / "config" / "settings.toml"


def _load_profile(environment: Environment) -> dict[str, Any]:
    settings_file = _settings_file()
    if not settings_file.is_file():
        raise FileNotFoundError(
            f"Settings file not found: {settings_file}. "
            "Copy config/settings.example.toml to config/settings.toml first."
        )

    with settings_file.open("rb") as file:
        profiles = tomllib.load(file)

    profile = profiles.get(environment)
    if not isinstance(profile, dict):
        raise ValueError(
            f"Profile [{environment}] not found in settings file: {settings_file}"
        )
    return profile


class Settings(BaseModel):
    """Validated values loaded from one profile in config/settings.toml."""

    model_config = ConfigDict(extra="forbid")

    app_name: str = "Shell Forecast Backend"
    app_version: str = "0.1.0"
    app_env: Environment
    debug: bool = False
    docs_enabled: bool = True
    api_v1_prefix: str = "/api/v1"

    database_url: SecretStr
    db_echo: bool = False
    cors_origins: list[str] = Field(default_factory=list)

    sso_enabled: bool = False
    sso_issuer: str | None = None
    sso_client_id: str | None = None
    sso_client_secret: SecretStr | None = None


@lru_cache
def get_settings() -> Settings:
    environment = _selected_environment()
    profile = _load_profile(environment)
    return Settings.model_validate({**profile, "app_env": environment})
