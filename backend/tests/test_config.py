from pytest import MonkeyPatch

from app.core.config import get_settings


def test_dev_alias_selects_development_profile(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "dev")
    get_settings.cache_clear()
    settings = get_settings()
    assert settings.app_env == "development"
    assert settings.debug is True
    get_settings.cache_clear()


def test_prod_alias_selects_production_profile(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "prod")
    get_settings.cache_clear()
    settings = get_settings()
    assert settings.app_env == "production"
    assert settings.debug is False
    assert settings.docs_enabled is False
    get_settings.cache_clear()
