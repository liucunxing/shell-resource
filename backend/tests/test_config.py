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


def test_databricks_environment_values_override_profile(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("DATABRICKS_SERVER_HOSTNAME", "adb.example.test")
    monkeypatch.setenv("DATABRICKS_HTTP_PATH", "/sql/1.0/warehouses/warehouse-1")
    monkeypatch.setenv("DATABRICKS_CLIENT_ID", "client-id")
    monkeypatch.setenv("DATABRICKS_CLIENT_SECRET", "secret-value")
    get_settings.cache_clear()

    settings = get_settings()

    assert settings.databricks_server_hostname == "adb.example.test"
    assert settings.databricks_http_path.endswith("warehouse-1")
    assert settings.databricks_client_secret is not None
    assert settings.databricks_client_secret.get_secret_value() == "secret-value"
    get_settings.cache_clear()
