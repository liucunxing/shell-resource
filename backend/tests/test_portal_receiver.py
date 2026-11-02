"""Real receiver HTTP + isolated SQLite; no Portal, source DB or vendor is contacted."""

import base64
import time
from dataclasses import dataclass
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import jwt
import pytest
import pytest_asyncio
from fastapi import FastAPI
from pydantic import SecretStr
from sqlalchemy import select

from app.api.router import api_router
from app.core.config import get_settings
from app.core.exception_handlers import register_exception_handlers
from app.db.session import get_db_session
from app.dependencies.storage import get_workbench_blob_storage
from app.models.do.portal_embed import PortalSessionDO
from app.models.do.workspace import UserPermissionDO
from app.portal_embed.app import create_portal_app
from app.portal_embed.config import COOKIE_NAME, PortalConfig, normalized_email
from app.repositories.distributor_directory_repository import DatabricksDistributorRepository
from app.services.workbench_service import WorkbenchService
from test_workspace import _session

KEY = bytes(range(32))  # Public synthetic key; only this test uses it.
PORTAL = "https://portal.example.invalid"
RESOURCE = "https://resource.example.invalid"
PREFIX = "/portal-embed"


def ticket(email="a@example.com", subject="employee-a", **changes):
    now = int(time.time())
    payload = {
        "iss": PORTAL,
        "aud": "resource-investment",
        "sub": subject,
        "iat": now,
        "exp": now + 60,
        "jti": str(uuid4()),
        "purpose": "embed_login",
        "schemaVersion": "1.0",
        "resourceId": "home",
        "requestId": str(uuid4()),
        "instanceId": str(uuid4()),
        "embedderOrigin": PORTAL,
        "claims": {"email": email},
    }
    payload.update(changes)
    return jwt.encode(
        payload, KEY, algorithm="HS256", headers={"kid": "resource-investment-01", "typ": "JWT"}
    ), payload["instanceId"]


def receiver_settings(**changes):
    return get_settings().model_copy(
        update={
            "resource_portal_enabled": True,
            "resource_portal_origin": RESOURCE,
            "resource_portal_parent_origins": [PORTAL],
            "resource_portal_issuer": PORTAL,
            "resource_portal_key": SecretStr(base64.b64encode(KEY).decode()),
            **changes,
        }
    )


@dataclass
class Harness:
    client: httpx.AsyncClient
    db: object
    app: FastAPI

    async def login(self, email="a@example.com", subject="employee-a", assertion=None, **changes):
        signed, instance = ticket(email, subject, **changes)
        response = await self.client.post(
            PREFIX + "/login", data={"assertion": assertion or signed}, headers={"Origin": PORTAL}
        )
        return response, instance

    async def headers(self, instance):
        response = await self.client.get(PREFIX + "/api/session/" + instance)
        assert response.status_code == 200, response.text
        return {
            "X-Portal-Instance": instance,
            "X-Portal-CSRF": response.json()["csrfToken"],
            "Origin": RESOURCE,
        }


@pytest_asyncio.fixture
async def harness(monkeypatch):
    db = await _session()
    db.add_all(
        [
            UserPermissionDO(
                id=2,
                email="b@example.com",
                display_name="B",
                role="owner",
                department=["MKT"],
                sector=["PCMO"],
                enabled=True,
            ),
            UserPermissionDO(
                id=3,
                email="disabled@example.com",
                display_name="Disabled",
                role="owner",
                department=["MKT"],
                sector=["PCMO"],
                enabled=False,
            ),
            UserPermissionDO(
                id=4,
                email="forbidden@example.com",
                display_name="Forbidden",
                role="invalid",
                department=[],
                enabled=True,
            ),
        ]
    )
    await db.commit()
    app = FastAPI()
    register_exception_handlers(app)
    app.include_router(api_router, prefix="/api/v1")
    receiver = create_portal_app(receiver_settings())
    app.mount(PREFIX, receiver)

    async def database():
        yield db

    app.dependency_overrides[get_db_session] = database
    receiver.dependency_overrides[get_db_session] = database
    monkeypatch.setattr(
        DatabricksDistributorRepository,
        "list_distributors",
        AsyncMock(
            return_value=[
                {"distributor_code": "d1", "distributor_name": "Dealer 1", "sector": "PCMO"},
                {"distributor_code": "d2", "distributor_name": "Dealer 2", "sector": "PCMO"},
            ]
        ),
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url=RESOURCE, follow_redirects=False
    ) as client:
        yield Harness(client, db, app)
    await db.close()
    await db.bind.dispose()


@pytest.mark.asyncio
async def test_login_cookie_context_and_two_identity_routes(harness):
    response, instance = await harness.login("b@example.com", "employee-b")
    assert response.status_code == 303, response.text
    assert response.headers["location"] == PREFIX + "/bootstrap/" + instance
    cookie = response.headers["set-cookie"]
    assert "HttpOnly" in cookie and "Secure" in cookie and "Path=/portal-embed" in cookie
    assert "Domain=" not in cookie and "SameSite=lax" in cookie
    assert response.headers["cache-control"] == "no-store"
    assert "assertion" not in response.headers["location"]
    context = await harness.client.get(PREFIX + "/api/context/" + instance)
    assert context.status_code == 200
    assert set(context.json()) == {
        "protocolVersion",
        "requestId",
        "instanceId",
        "appId",
        "embedderOrigin",
        "landingPath",
    }
    assert context.json()["appId"] == "resource-investment"
    assert context.headers["content-security-policy"] == "frame-ancestors " + PORTAL
    headers = await harness.headers(instance)
    new = await harness.client.get(
        PREFIX + "/api/v1/workbench/workspace?planning_year=2027&user_email=a@example.com",
        headers={**headers, "X-User-Email": "a@example.com"},
    )
    assert new.status_code == 200, new.text
    assert new.json()["data"]["identity"]["email"] == "b@example.com"
    legacy = await harness.client.get(
        "/api/v1/workbench/workspace?planning_year=2027", headers={"X-User-Email": "a@example.com"}
    )
    assert legacy.status_code == 200
    assert legacy.json()["data"]["identity"]["email"] == "a@example.com"
    assert (
        await harness.client.get("/api/v1/workbench/workspace?planning_year=2027")
    ).status_code == 401


@pytest.mark.asyncio
async def test_session_fixation_multiinstance_account_switch_and_logout(harness):
    response, first = await harness.login()
    old_cookie = harness.client.cookies.get(COOKIE_NAME)
    old_headers = await harness.headers(first)
    response, second = await harness.login()
    assert response.status_code == 303
    assert harness.client.cookies.get(COOKIE_NAME) != old_cookie
    assert (await harness.client.get(PREFIX + "/api/context/" + first)).status_code == 200
    assert (await harness.client.get(PREFIX + "/api/context/" + second)).status_code == 200
    assert (await harness.headers(second))["X-Portal-CSRF"] == old_headers["X-Portal-CSRF"]
    stale = await harness.client.get(
        PREFIX + "/api/context/" + first, headers={"Cookie": COOKIE_NAME + "=" + old_cookie}
    )
    assert stale.status_code == 401
    _, third = await harness.login("b@example.com", "employee-b")
    assert (await harness.client.get(PREFIX + "/api/context/" + first)).status_code == 409
    assert (await harness.client.get(PREFIX + "/api/context/" + second)).status_code == 409
    assert (await harness.headers(third))["X-Portal-CSRF"] != old_headers["X-Portal-CSRF"]
    old_tab = await harness.client.get(
        PREFIX + "/api/v1/workbench/workspace?planning_year=2027", headers=old_headers
    )
    assert old_tab.status_code == 409
    headers = await harness.headers(third)
    assert (
        await harness.client.post(PREFIX + "/logout", headers={"X-Portal-Instance": third})
    ).status_code == 403
    logout = await harness.client.post(PREFIX + "/logout", headers=headers)
    assert logout.status_code == 200
    assert "Max-Age=0" in logout.headers["set-cookie"]
    assert (await harness.client.get(PREFIX + "/api/context/" + third)).status_code == 401
    legacy = await harness.client.get(
        "/api/v1/workbench/workspace?planning_year=2027", headers={"X-User-Email": "a@example.com"}
    )
    assert legacy.status_code == 200


@pytest.mark.asyncio
async def test_csrf_and_direct_read_write_authorization(harness):
    _, instance = await harness.login()
    headers = await harness.headers(instance)
    path = PREFIX + "/api/v1/workbench/initiatives/1/draft"
    body = {
        "expected_revision": 0,
        "rows": [{"dealerId": "d1", "amount": "20", "note": "test"}],
        "otherBudgets": [],
    }
    assert (
        await harness.client.put(path, json=body, headers={"X-Portal-Instance": instance})
    ).status_code == 403
    assert (
        await harness.client.put(path, json=body, headers={**headers, "Origin": PORTAL})
    ).status_code == 403
    saved = await harness.client.put(path, json=body, headers=headers)
    assert saved.status_code == 200, saved.text
    assert saved.json()["data"]["revision"] == 1
    denied = await harness.client.get(
        PREFIX + "/api/v1/workbench/initiatives/2/draft", headers=headers
    )
    assert denied.status_code == 404
    assert (
        await harness.client.put(
            PREFIX + "/api/v1/workbench/initiatives/2/draft", json=body, headers=headers
        )
    ).status_code == 404
    assert (
        await harness.client.get(PREFIX + "/api/v1/workbench/admin/users", headers=headers)
    ).status_code == 403


@pytest.mark.asyncio
@pytest.mark.parametrize("change,expected", [("disabled", 403), ("scope", 401), ("deleted", 409)])
async def test_revocation_and_scope_changes_cover_context_session_and_business(
    harness, change, expected
):
    _, instance = await harness.login()
    headers = await harness.headers(instance)
    user = await harness.db.get(UserPermissionDO, 1)
    if change == "disabled":
        user.enabled = False
    elif change == "scope":
        user.sector = ["CRTO"]
    else:
        await harness.db.delete(user)
    await harness.db.commit()
    for path in [
        "/api/context/" + instance,
        "/api/session/" + instance,
        "/api/v1/workbench/workspace?planning_year=2027",
    ]:
        response = await harness.client.get(PREFIX + path, headers=headers)
        assert response.status_code == expected, response.text


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "email,status,code",
    [
        ("missing@example.com", 409, "USER_UNMAPPED"),
        ("disabled@example.com", 403, "USER_DISABLED"),
        ("forbidden@example.com", 403, "RESOURCE_FORBIDDEN"),
        ("bad", 401, "ASSERTION_INVALID"),
        (None, 401, "ASSERTION_INVALID"),
    ],
)
async def test_account_login_rejection(harness, email, status, code):
    response, _ = await harness.login(email)
    assert response.status_code == status
    assert response.json()["msg"] == code
    assert "set-cookie" not in response.headers
    assert (await harness.db.scalars(select(PortalSessionDO))).all() == []


@pytest.mark.asyncio
@pytest.mark.parametrize("origin", [None, "null", "https://evil.example.invalid", PORTAL + "/"])
async def test_login_origin_required_exact(harness, origin):
    signed, _ = ticket()
    response = await harness.client.post(
        PREFIX + "/login", data={"assertion": signed}, headers={"Origin": origin} if origin else {}
    )
    assert response.status_code == 403
    assert response.headers["cache-control"] == "no-store"
    assert "set-cookie" not in response.headers


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "body,media",
    [
        ("assertion=a&assertion=b", "application/x-www-form-urlencoded"),
        ("assertion=a&email=a@example.com", "application/x-www-form-urlencoded"),
        ("assertion=", "application/x-www-form-urlencoded"),
        ('{"assertion":"secret"}', "application/json"),
        ("assertion=" + "a" * 22000, "application/x-www-form-urlencoded"),
    ],
)
async def test_form_is_bounded_unique_and_never_echoed(harness, body, media):
    response = await harness.client.post(
        PREFIX + "/login", content=body, headers={"Origin": PORTAL, "Content-Type": media}
    )
    assert response.status_code == 400
    assert response.json() == {"code": 400, "msg": "INVALID_REQUEST", "data": None}
    assert "set-cookie" not in response.headers


@pytest.mark.asyncio
async def test_expired_invalid_and_resource_failures_preserve_existing_session(harness):
    _, instance = await harness.login()
    cookie = harness.client.cookies.get(COOKIE_NAME)
    for changes, expected in [
        ({"exp": int(time.time()) - 10, "iat": int(time.time()) - 60}, 401),
        ({"aud": "other-app"}, 401),
        ({"resourceId": "unknown"}, 403),
    ]:
        response, _ = await harness.login(**changes)
        assert response.status_code == expected
        assert "set-cookie" not in response.headers
        assert harness.client.cookies.get(COOKIE_NAME) == cookie
    assert (await harness.client.get(PREFIX + "/api/context/" + instance)).status_code == 200


@pytest.mark.asyncio
async def test_time_bound_replay_and_session_expiry(harness):
    signed, instance = ticket()
    for _ in range(2):
        response = await harness.client.post(
            PREFIX + "/login", data={"assertion": signed}, headers={"Origin": PORTAL}
        )
        assert response.status_code == 303
    current = await harness.db.scalar(select(PortalSessionDO))
    current.expires_at = int(time.time()) - 1
    await harness.db.commit()
    assert (await harness.client.get(PREFIX + "/api/session/" + instance)).status_code == 401
    # Known, expired credential can establish a new session, never use old context.
    response, fresh = await harness.login()
    assert response.status_code == 303
    assert (await harness.client.get(PREFIX + "/api/context/" + fresh)).status_code == 200
    assert (await harness.client.get(PREFIX + "/api/context/" + instance)).status_code == 409


@pytest.mark.asyncio
async def test_rotated_cookie_cannot_fork_concurrent_launch_or_erase_winner(harness):
    _, first = await harness.login()
    stale_cookie = harness.client.cookies.get(COOKIE_NAME)
    _, second = await harness.login()
    winner_cookie = harness.client.cookies.get(COOKIE_NAME)
    signed, _ = ticket()
    response = await harness.client.post(
        PREFIX + "/login",
        data={"assertion": signed},
        headers={"Origin": PORTAL, "Cookie": COOKIE_NAME + "=" + stale_cookie},
    )
    assert response.status_code == 409
    assert "set-cookie" not in response.headers
    assert harness.client.cookies.get(COOKIE_NAME) == winner_cookie
    assert len((await harness.db.scalars(select(PortalSessionDO))).all()) == 1
    for instance in (first, second):
        assert (await harness.client.get(PREFIX + "/api/context/" + instance)).status_code == 200


@pytest.mark.asyncio
async def test_anonymous_and_cross_session_instance_denied(harness):
    _, instance = await harness.login()
    response = await harness.client.get(PREFIX + "/api/context/" + str(uuid4()))
    assert response.status_code == 409
    harness.client.cookies.clear()
    assert (await harness.client.get(PREFIX + "/api/context/" + instance)).status_code == 401
    assert (
        await harness.client.get(
            PREFIX + "/api/v1/workbench/workspace?planning_year=2027",
            headers={"X-User-Email": "a@example.com"},
        )
    ).status_code == 401
    _, other = await harness.login("b@example.com", "employee-b")
    assert (await harness.client.get(PREFIX + "/api/context/" + instance)).status_code == 409
    assert (await harness.client.get(PREFIX + "/api/context/" + other)).status_code == 200


@pytest.mark.asyncio
async def test_session_metadata_not_readable_via_legacy_cors_origin(harness):
    _, instance = await harness.login()
    response = await harness.client.get(
        PREFIX + "/api/session/" + instance,
        headers={"Origin": "https://legacy-frontend.example.invalid"},
    )
    assert response.status_code == 403
    assert "csrfToken" not in response.text


@pytest.mark.asyncio
async def test_disabled_user_can_explicitly_logout_only_new_session(harness):
    _, instance = await harness.login()
    headers = await harness.headers(instance)
    user = await harness.db.get(UserPermissionDO, 1)
    user.enabled = False
    await harness.db.commit()
    response = await harness.client.post(PREFIX + "/logout", headers=headers)
    assert response.status_code == 200
    assert "Max-Age=0" in response.headers["set-cookie"]


@pytest.mark.asyncio
async def test_download_endpoint_requires_current_portal_permission(harness, monkeypatch):
    download = AsyncMock(
        return_value=("synthetic.xlsx", b"synthetic-file", "application/octet-stream")
    )
    monkeypatch.setattr(WorkbenchService, "download_import_template", download)
    receiver = harness.app.routes[-1].app
    receiver.dependency_overrides[get_workbench_blob_storage] = lambda: object()
    path = PREFIX + "/api/v1/workbench/distributor-allocation-template"
    assert (
        await harness.client.get(path, headers={"X-User-Email": "a@example.com"})
    ).status_code == 401
    download.assert_not_awaited()
    _, instance = await harness.login()
    headers = await harness.headers(instance)
    result = await harness.client.get(path, headers=headers)
    assert result.status_code == 200 and result.content == b"synthetic-file"
    assert result.headers["cache-control"] == "no-store"
    download.assert_awaited_once()
    download.reset_mock()
    user = await harness.db.get(UserPermissionDO, 1)
    user.enabled = False
    await harness.db.commit()
    assert (await harness.client.get(path, headers=headers)).status_code == 403
    download.assert_not_awaited()


@pytest.mark.asyncio
async def test_disabled_receiver_routes_fail_closed_without_affecting_legacy():
    app = create_portal_app(get_settings())
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url=RESOURCE
    ) as client:
        response = await client.post("/login", data={"assertion": "not-a-ticket"})
        assert response.status_code == 404
        assert response.json()["msg"] == "RECEIVER_DISABLED"


@pytest.mark.parametrize(
    "changes",
    [
        {"resource_portal_key": None},
        {"resource_portal_key": SecretStr("bad")},
        {"resource_portal_origin": RESOURCE + "/"},
        {"resource_portal_parent_origins": []},
        {"resource_portal_cookie_secure": False},
        {"resource_portal_app_id": "../bad"},
        {"app_env": "production", "resource_portal_allow_loopback_http": True},
    ],
)
def test_enabled_bad_configuration_fails_startup(changes):
    with pytest.raises(ValueError):
        create_portal_app(receiver_settings(**changes))


def test_explicit_loopback_configuration():
    settings = receiver_settings(
        resource_portal_origin="http://127.0.0.1:18184",
        resource_portal_issuer="http://127.0.0.1:18181",
        resource_portal_parent_origins=["http://127.0.0.1:18181"],
        resource_portal_allow_loopback_http=True,
        resource_portal_cookie_secure=False,
    )
    assert PortalConfig.from_settings(settings).cookie_secure is False
    with pytest.raises(ValueError):
        PortalConfig.from_settings(
            settings.model_copy(update={"resource_portal_cookie_samesite": "none"})
        )


@pytest.mark.parametrize(
    "email",
    [
        ".a@example.com",
        "a..b@example.com",
        "a.@example.com",
        "a" * 65 + "@example.com",
        "a@" + "x" * 64 + ".com",
        "用@example.com",
        " a@example.com",
    ],
)
def test_email_matches_portal_conservative_ascii_mapping(email):
    with pytest.raises(ValueError):
        normalized_email(email)
    assert normalized_email("A.B+test@EXAMPLE.COM") == "a.b+test@example.com"
