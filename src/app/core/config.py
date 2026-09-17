import os
from functools import lru_cache
from pathlib import Path
from typing import Literal

from dotenv import dotenv_values
from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[3]


def _selected_environment() -> str:
    """Resolve APP_ENV before Pydantic selects the environment-specific file."""
    if value := os.getenv("APP_ENV"):
        return value
    root_env = dotenv_values(PROJECT_ROOT / ".env")
    return str(root_env.get("APP_ENV") or "development")


def _environment_files() -> tuple[Path, Path]:
    environment = _selected_environment()
    return PROJECT_ROOT / "config" / "env" / f".env.{environment}", PROJECT_ROOT / ".env"


class Settings(BaseSettings):
    """Typed application settings. OS variables override both configuration files."""

    model_config = SettingsConfigDict(
        env_file=_environment_files(),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "Shell Forecast Backend"
    app_version: str = "0.1.0"
    app_env: Literal["development", "test", "production"] = "development"
    debug: bool = False
    docs_enabled: bool = True
    api_v1_prefix: str = "/api/v1"

    database_url: SecretStr = SecretStr("sqlite+aiosqlite:///./data/shell_forecast.db")
    db_echo: bool = False

    cors_origins: list[str] = Field(default_factory=list)

    sso_enabled: bool = False
    sso_issuer: str | None = None
    sso_client_id: str | None = None
    sso_client_secret: SecretStr | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
