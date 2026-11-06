from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError
from starlette.routing import NoMatchFound

from app.controllers import data_agent_controller
from app.core.config import Settings, get_settings
from app.db.session import get_db_session
from app.dependencies import workbench_user
from app.main import create_app

URL = "/api/v1/workbench/data-agent/launch"
EMAIL = "uat@example.com"
INGRESS_KEY = "fixture-only-verified-ingress-key-which-is-never-deployed"
HEADERS = {"X-User-Email": EMAIL.upper(), "X-Resource-Ingress-Key": INGRESS_KEY,
           "X-Resource-Verified-Email": EMAIL.upper()}


@pytest.fixture
def launch(monkeypatch):
    app = create_app()
    settings = get_settings().model_copy(update={
        "data_agent_base_url": "https://vendor.example.test",
        "data_agent_api_token": SecretStr("synthetic-service-key"),
        "data_agent_ingress_key": SecretStr(INGRESS_KEY),
        "data_agent_uat_emails": [EMAIL],
    })
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_db_session] = lambda: None
    monkeypatch.setattr(workbench_user, "get_settings", lambda: settings)
    record = SimpleNamespace(email=EMAIL, role="admin", department=None,
                             display_name="UAT", sector=None)
    lookup = AsyncMock(return_value=record)
    monkeypatch.setattr(workbench_user.WorkspaceRepository, "get_permission", lookup)
    url = "https://vendor.example.test/admin/chat?token=synthetic-user-ticket&space=default"
    exchange = AsyncMock(return_value=url)
    monkeypatch.setattr(data_agent_controller, "exchange_data_agent_ticket", exchange)
    with TestClient(app) as client:
        yield SimpleNamespace(client=client, settings=settings, lookup=lookup,
                              exchange=exchange, url=url, record=record)


def test_launch_with_resolved_workbench_email(launch):
    response = launch.client.post(URL, headers=HEADERS)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["data"] == {"iframeUrl": launch.url}
    launch.exchange.assert_awaited_once_with(
        email=EMAIL, origin=launch.settings.data_agent_base_url,
        api_token="synthetic-service-key", space="default",
    )
    assert launch.lookup.await_count == 2


@pytest.mark.parametrize(("path", "options", "expected"), [
    (URL, {}, 401),
    (URL + "?email=another@example.com", {"headers": HEADERS}, 400),
    (URL, {"headers": HEADERS, "json": {"email": "another@example.com"}}, 400),
    ("/portal-embed" + URL, {"headers": HEADERS}, 404),
])
def test_refuses_unsupported_inputs(launch, path, options, expected):
    assert launch.client.post(path, **options).status_code == expected
    launch.exchange.assert_not_awaited()


@pytest.mark.parametrize(("field", "value", "expected"), [
    ("app_env", "production", 401),
    ("data_agent_uat_emails", [], 403),
    ("data_agent_uat_emails", ["other@example.com"], 403),
    ("data_agent_base_url", "", 503),
    ("data_agent_api_token", None, 503),
    ("data_agent_ingress_key", None, 503),
    ("data_agent_ingress_key", SecretStr("short"), 503),
    ("data_agent_ingress_key", SecretStr("é" * 32), 503),
])
def test_requires_explicit_uat_configuration(launch, field, value, expected):
    setattr(launch.settings, field, value)
    assert launch.client.post(URL, headers=HEADERS).status_code == expected
    launch.exchange.assert_not_awaited()


@pytest.mark.parametrize("headers", [
    {"X-User-Email": EMAIL},
    {"X-User-Email": EMAIL, "X-Resource-Verified-Email": EMAIL},
    {"X-User-Email": EMAIL, "X-Resource-Ingress-Key": INGRESS_KEY},
    {**HEADERS, "X-Resource-Ingress-Key": "wrong"},
    {**HEADERS, "X-Resource-Verified-Email": "other@example.com"},
    {**HEADERS, "X-Resource-Verified-Email": EMAIL + "," + EMAIL},
    [*HEADERS.items(), ("X-Resource-Ingress-Key", INGRESS_KEY)],
    [*HEADERS.items(), ("X-Resource-Verified-Email", EMAIL)],
])
def test_allowlisted_workbench_email_needs_unambiguous_ingress_identity(launch, headers):
    response = launch.client.post(URL, headers=headers)
    assert response.status_code == 403
    assert INGRESS_KEY not in response.text
    launch.exchange.assert_not_awaited()


def test_disabled_workbench_user_cannot_launch(launch):
    launch.lookup.return_value = None
    assert launch.client.post(URL, headers=HEADERS).status_code == 403
    launch.exchange.assert_not_awaited()


def test_direct_route_is_only_registered_on_root_application(launch):
    root = launch.client.app
    assert root.url_path_for("launch_data_agent") == URL
    with pytest.raises(NoMatchFound):
        root.state.portal_embed.url_path_for("launch_data_agent")


def test_permission_revoked_during_exchange_withholds_ticket(launch):
    launch.lookup.side_effect = [launch.record, None]
    response = launch.client.post(URL, headers=HEADERS)
    assert response.status_code == 403
    assert "synthetic-user-ticket" not in response.text


def test_configuration_requires_individual_normalized_email():
    values = get_settings().model_dump()
    values["data_agent_uat_emails"] = [" UAT@example.com "]
    assert Settings.model_validate(values).data_agent_uat_emails == [EMAIL]
    values["data_agent_uat_emails"] = ["*@example.com"]
    with pytest.raises(ValidationError):
        Settings.model_validate(values)


def test_workbench_mode_uses_existing_permission_without_per_user_allowlist(launch):
    launch.settings.data_agent_access_mode = "workbench"
    launch.settings.data_agent_uat_emails = []
    response = launch.client.post(URL, headers=HEADERS)
    assert response.status_code == 200
    assert launch.lookup.await_count == 2
    launch.exchange.assert_awaited_once()


@pytest.mark.parametrize("headers", [
    {"X-User-Email": EMAIL},
    {**HEADERS, "X-Resource-Verified-Email": "other@example.com"},
    {**HEADERS, "X-Resource-Ingress-Key": "wrong"},
])
def test_workbench_mode_still_requires_verified_identity(launch, headers):
    launch.settings.data_agent_access_mode = "workbench"
    launch.settings.data_agent_uat_emails = []
    assert launch.client.post(URL, headers=headers).status_code == 403
    launch.exchange.assert_not_awaited()


@pytest.mark.parametrize("revoked_during_exchange", [False, True])
def test_workbench_mode_rejects_missing_or_revoked_permission(launch, revoked_during_exchange):
    launch.settings.data_agent_access_mode = "workbench"
    launch.settings.data_agent_uat_emails = []
    launch.lookup.side_effect = [launch.record, None] if revoked_during_exchange else [None]
    response = launch.client.post(URL, headers=HEADERS)
    assert response.status_code == 403
    assert "synthetic-user-ticket" not in response.text
    assert launch.exchange.await_count == int(revoked_during_exchange)


def test_access_mode_is_explicit_and_defaults_to_uat():
    values = get_settings().model_dump()
    values.pop("data_agent_access_mode", None)
    assert Settings.model_validate(values).data_agent_access_mode == "uat"
    values["data_agent_access_mode"] = "all"
    with pytest.raises(ValidationError):
        Settings.model_validate(values)


def test_email_mode_reuses_workbench_permission_without_ingress_or_user_list(launch):
    launch.settings.data_agent_access_mode = "workbench_email"
    launch.settings.data_agent_uat_emails = []
    launch.settings.data_agent_ingress_key = None
    response = launch.client.post(URL, headers={"X-User-Email": EMAIL.upper()})
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert launch.lookup.await_count == 2
    launch.exchange.assert_awaited_once()


@pytest.mark.parametrize("mode", ["uat", "workbench", "workbench_email"])
def test_every_mode_rejects_ambiguous_email_headers(launch, mode):
    launch.settings.data_agent_access_mode = mode
    response = launch.client.post(URL, headers=[*HEADERS.items(), ("X-User-Email", EMAIL)])
    assert response.status_code == 400
    launch.exchange.assert_not_awaited()


def test_email_mode_remains_disabled_in_production(launch):
    launch.settings.data_agent_access_mode = "workbench_email"
    launch.settings.app_env = "production"
    assert launch.client.post(URL, headers={"X-User-Email": EMAIL}).status_code == 401
    launch.exchange.assert_not_awaited()


@pytest.mark.parametrize("revoked_during_exchange", [False, True])
def test_email_mode_still_checks_permission_and_rechecks_before_returning(
    launch, revoked_during_exchange,
):
    launch.settings.data_agent_access_mode = "workbench_email"
    launch.lookup.side_effect = [launch.record, None] if revoked_during_exchange else [None]
    response = launch.client.post(URL, headers={"X-User-Email": EMAIL})
    assert response.status_code == 403
    assert "synthetic-user-ticket" not in response.text
    assert launch.exchange.await_count == int(revoked_during_exchange)
