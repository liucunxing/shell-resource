"""Database-backed sessions and request-scoped Portal authentication."""

import hashlib
import json
import secrets
import time
from typing import Annotated
from uuid import uuid4

from fastapi import Depends, HTTPException, Request
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.departments import departments
from app.db.session import get_db_session
from app.dependencies.workbench_user import WorkbenchUser
from app.models.do.portal_embed import PortalContextDO, PortalSessionDO
from app.models.do.workspace import UserPermissionDO
from app.portal_embed.config import (
    COOKIE_NAME,
    LANDING_PATH,
    TOKEN_PATTERN,
    UUID_PATTERN,
    PortalConfig,
)


def fail(status: int, code: str) -> HTTPException:
    return HTTPException(status_code=status, detail=code)


def fingerprint(permission: UserPermissionDO) -> str:
    value = [
        permission.role,
        sorted(departments(permission.department)),
        sorted(permission.sector or []),
    ]
    return hashlib.sha256(json.dumps(value, ensure_ascii=True).encode()).hexdigest()


async def permission_for_email(db: AsyncSession, email: str) -> UserPermissionDO:
    permission = await db.scalar(
        select(UserPermissionDO)
        .where(UserPermissionDO.email == email)
        .execution_options(populate_existing=True)
    )
    if permission is None:
        raise fail(409, "USER_UNMAPPED")
    if not permission.enabled:
        raise fail(403, "USER_DISABLED")
    if permission.role not in {"owner", "lead", "management", "admin"} or (
        permission.role in {"owner", "lead"} and not departments(permission.department)
    ):
        raise fail(403, "RESOURCE_FORBIDDEN")
    return permission


def workbench_user(permission: UserPermissionDO) -> WorkbenchUser:
    return WorkbenchUser(
        permission.email,
        permission.role,
        permission.department,
        permission.display_name,
        tuple(permission.sector or ()),
    )


def single_header(request: Request, name: str) -> str | None:
    values = request.headers.getlist(name)
    if len(values) != 1:
        return None
    return values[0]


def _cookie(request: Request) -> str | None:
    # Reject ambiguous duplicate cookie values rather than relying on parser order.
    values = [
        part.strip().split("=", 1)[0]
        for header in request.headers.getlist("cookie")
        for part in header.split(";")
    ]
    if values.count(COOKIE_NAME) != 1:
        return None
    value = request.cookies.get(COOKIE_NAME)
    return value if value and TOKEN_PATTERN.fullmatch(value) else None


async def _find_session(
    db: AsyncSession, cookie: str | None, *, lock: bool = False, include_expired: bool = False
) -> PortalSessionDO | None:
    if not cookie:
        return None
    statement = (
        select(PortalSessionDO)
        .where(
            PortalSessionDO.token_hash == hashlib.sha256(cookie.encode()).hexdigest(),
        )
        .execution_options(populate_existing=True)
    )
    if not include_expired:
        statement = statement.where(PortalSessionDO.expires_at > int(time.time()))
    if lock:
        statement = statement.with_for_update()
    return await db.scalar(statement)


async def session_context(
    request: Request, db: AsyncSession, instance_id: str
) -> tuple[PortalSessionDO, PortalContextDO]:
    # Legacy CORS configuration must not make Portal's private session API readable
    # by another allowed development/frontend origin.
    if "/api/" in request.url.path and request.headers.getlist("origin"):
        config: PortalConfig = request.app.state.portal_config
        if single_header(request, "origin") != config.resource_origin:
            raise fail(403, "ORIGIN_REJECTED")
    if not UUID_PATTERN.fullmatch(instance_id):
        raise fail(409, "CONTEXT_INVALID")
    current = await _find_session(db, _cookie(request))
    if current is None:
        raise fail(401, "SESSION_REQUIRED")
    context = await db.get(PortalContextDO, (current.id, instance_id))
    if context is None:
        raise fail(409, "CONTEXT_INVALID")
    return current, context


async def authenticate(
    request: Request, db: AsyncSession, instance_id: str
) -> tuple[PortalSessionDO, PortalContextDO, WorkbenchUser]:
    current, context = await session_context(request, db, instance_id)
    permission = await permission_for_email(db, current.email)
    if (
        permission.id != current.permission_id
        or fingerprint(permission) != current.permission_fingerprint
    ):
        # Changed data scope requires a new launch, including cached client exports.
        raise fail(401, "SESSION_REQUIRED")
    return current, context, workbench_user(permission)


def check_csrf(request: Request, current: PortalSessionDO) -> None:
    config: PortalConfig = request.app.state.portal_config
    supplied = single_header(request, "x-portal-csrf")
    if (
        single_header(request, "origin") != config.resource_origin
        or not supplied
        or not secrets.compare_digest(supplied, current.csrf_token)
    ):
        raise fail(403, "CSRF_REJECTED")


async def get_portal_workbench_user(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db_session)],
) -> WorkbenchUser:
    instance = single_header(request, "x-portal-instance")
    if not instance:
        raise fail(401, "SESSION_REQUIRED")
    current, _, user = await authenticate(request, db, instance)
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        check_csrf(request, current)
    return user


async def establish_session(
    request: Request,
    db: AsyncSession,
    payload: dict,
    email: str,
    config: PortalConfig,
) -> str:
    permission = await permission_for_email(db, email)
    if payload["resourceId"] != "home":
        raise fail(403, "RESOURCE_FORBIDDEN")
    now = int(time.time())
    cookie = _cookie(request)
    current = await _find_session(db, cookie, lock=True, include_expired=True)
    if cookie and current is None:
        # A concurrent login already rotated this credential. Do not fork a second
        # session or clear the winner's cookie; the browser can launch again using it.
        raise fail(409, "CONTEXT_INVALID")
    if current and current.expires_at <= now:
        await db.execute(delete(PortalContextDO).where(PortalContextDO.session_id == current.id))
        await db.delete(current)
        current = None
    # Keep a short expiry grace for a valid cookie arriving at its expiry boundary.
    # Browser Max-Age removes it normally; expired rows never authorize a request.
    expired = select(PortalSessionDO.id).where(PortalSessionDO.expires_at <= now - 300)
    await db.execute(delete(PortalContextDO).where(PortalContextDO.session_id.in_(expired)))
    await db.execute(delete(PortalSessionDO).where(PortalSessionDO.expires_at <= now - 300))
    raw_token = secrets.token_urlsafe(32)
    if current is None:
        current = PortalSessionDO(id=str(uuid4()))
        db.add(current)
    elif (
        current.subject != payload["sub"]
        or current.permission_id != permission.id
        or current.email != email
        or current.permission_fingerprint != fingerprint(permission)
    ):
        await db.execute(delete(PortalContextDO).where(PortalContextDO.session_id == current.id))
        current.csrf_token = secrets.token_urlsafe(32)
    current.token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    current.subject = payload["sub"]
    current.email = email
    current.permission_id = permission.id
    current.permission_fingerprint = fingerprint(permission)
    # Same-user additional instances retain CSRF so existing tabs continue to work.
    current.csrf_token = current.csrf_token or secrets.token_urlsafe(32)
    current.expires_at = now + config.session_ttl_seconds
    await db.flush()
    context = await db.get(PortalContextDO, (current.id, payload["instanceId"]))
    if context is None:
        count = await db.scalar(
            select(func.count())
            .select_from(PortalContextDO)
            .where(PortalContextDO.session_id == current.id)
        )
        if count is not None and count >= 32:
            raise fail(429, "RATE_LIMITED")
        context = PortalContextDO(session_id=current.id, instance_id=payload["instanceId"])
        db.add(context)
    context.request_id = payload["requestId"]
    context.embedder_origin = payload["embedderOrigin"]
    context.app_id = config.app_id
    context.landing_path = LANDING_PATH
    await db.commit()
    return raw_token


async def revoke_session(db: AsyncSession, current: PortalSessionDO) -> None:
    await db.execute(delete(PortalContextDO).where(PortalContextDO.session_id == current.id))
    await db.delete(current)
    await db.commit()
