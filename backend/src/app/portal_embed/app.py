"""Isolated FastAPI receiver mounted under /portal-embed.

Only this subapplication substitutes the existing business identity dependency.
The original app and /api/v1 routes never accept the Portal cookie.
"""

from pathlib import Path
from typing import Annotated
from urllib.parse import parse_qsl

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.exceptions import HTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.controllers.insight_controller import router as insight_router
from app.controllers.workbench_controller import router as workbench_router
from app.core.config import Settings
from app.db.session import get_db_session
from app.dependencies.workbench_user import get_current_workbench_user
from app.portal_embed.config import COOKIE_NAME, PREFIX, PortalConfig, normalized_email
from app.portal_embed.session import (
    authenticate,
    check_csrf,
    establish_session,
    fail,
    get_portal_workbench_user,
    revoke_session,
    session_context,
    single_header,
)
from app.portal_embed.verifier import AssertionError, verify_assertion

MAX_FORM_BYTES = 20 * 1024


def error_response(status: int, code: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"code": status, "msg": code, "data": None},
        headers={"Cache-Control": "no-store"},
    )


class ReceiverHeaders:
    def __init__(self, app: ASGIApp, *, config: PortalConfig | None) -> None:
        self.app, self.config = app, config

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        if self.config is None:
            await error_response(404, "RECEIVER_DISABLED")(scope, receive, send)
            return

        async def send_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = [
                    (k, v)
                    for k, v in message.get("headers", [])
                    if k.lower()
                    not in {
                        b"cache-control",
                        b"pragma",
                        b"referrer-policy",
                        b"content-security-policy",
                    }
                ]
                ancestors = " ".join(sorted(self.config.verifier.parent_origins))
                headers.extend(
                    [
                        (b"cache-control", b"no-store"),
                        (b"pragma", b"no-cache"),
                        (b"referrer-policy", b"strict-origin-when-cross-origin"),
                        (b"x-content-type-options", b"nosniff"),
                        (
                            b"content-security-policy",
                            f"frame-ancestors {ancestors}".encode("ascii"),
                        ),
                    ]
                )
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_headers)


async def _assertion_form(request: Request) -> str:
    content_type = single_header(request, "content-type")
    if (
        not content_type
        or content_type.split(";", 1)[0].strip().lower() != "application/x-www-form-urlencoded"
    ):
        raise fail(400, "INVALID_REQUEST")
    length = single_header(request, "content-length")
    if length is not None and (
        not length.isascii() or not length.isdigit() or int(length) > MAX_FORM_BYTES
    ):
        raise fail(400, "INVALID_REQUEST")
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > MAX_FORM_BYTES:
            raise fail(400, "INVALID_REQUEST")
        data.extend(chunk)
    try:
        fields = parse_qsl(
            data.decode("ascii"),
            keep_blank_values=True,
            strict_parsing=True,
            errors="strict",
            max_num_fields=2,
        )
    except (ValueError, UnicodeError):
        raise fail(400, "INVALID_REQUEST") from None
    if len(fields) != 1 or fields[0][0] != "assertion" or not fields[0][1]:
        raise fail(400, "INVALID_REQUEST")
    if not fields[0][1].isascii() or len(fields[0][1]) > 16 * 1024:
        raise fail(400, "INVALID_REQUEST")
    return fields[0][1]


def create_portal_app(settings: Settings) -> FastAPI:
    config = PortalConfig.from_settings(settings) if settings.resource_portal_enabled else None
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.state.portal_config = config
    app.add_middleware(ReceiverHeaders, config=config)

    @app.exception_handler(HTTPException)
    async def http_error(_: Request, exc: HTTPException) -> JSONResponse:
        return error_response(exc.status_code, str(exc.detail))

    @app.exception_handler(RequestValidationError)
    async def input_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        # Never echo request inputs, which may contain credentials.
        return error_response(400, "INVALID_REQUEST")

    @app.exception_handler(SQLAlchemyError)
    async def database_error(_: Request, exc: SQLAlchemyError) -> JSONResponse:
        return error_response(503, "RECEIVER_UNAVAILABLE")

    @app.exception_handler(Exception)
    async def unexpected_error(_: Request, exc: Exception) -> JSONResponse:
        return error_response(503, "RECEIVER_UNAVAILABLE")

    # Deliberately scoped to this mounted application, never the legacy API app.
    app.dependency_overrides[get_current_workbench_user] = get_portal_workbench_user
    app.include_router(workbench_router, prefix="/api/v1/workbench")
    app.include_router(insight_router, prefix="/api/v1/workbench")

    @app.post("/login")
    async def login(
        request: Request, db: Annotated[AsyncSession, Depends(get_db_session)]
    ) -> RedirectResponse:
        assert config is not None  # disabled requests are stopped by ReceiverHeaders
        origin = single_header(request, "origin")
        if origin not in config.verifier.parent_origins:
            raise fail(403, "ORIGIN_REJECTED")
        assertion = await _assertion_form(request)
        try:
            payload = verify_assertion(assertion, config.verifier)
            email = normalized_email(payload["claims"].get("email"))
        except AssertionError as exc:
            raise fail(401, exc.code) from None
        except ValueError:
            raise fail(401, "ASSERTION_INVALID") from None
        if origin != payload["embedderOrigin"]:
            raise fail(403, "ORIGIN_REJECTED")
        token = await establish_session(request, db, payload, email, config)
        response = RedirectResponse(f"{PREFIX}/bootstrap/{payload['instanceId']}", status_code=303)
        response.set_cookie(
            COOKIE_NAME,
            token,
            max_age=config.session_ttl_seconds,
            path=PREFIX,
            secure=config.cookie_secure,
            httponly=True,
            samesite=config.cookie_samesite,
        )
        return response

    @app.get("/api/context/{instance_id}")
    async def context(
        request: Request, instance_id: str, db: Annotated[AsyncSession, Depends(get_db_session)]
    ) -> dict:
        _, stored, _ = await authenticate(request, db, instance_id)
        return {
            "protocolVersion": "1.0",
            "requestId": stored.request_id,
            "instanceId": stored.instance_id,
            "appId": stored.app_id,
            "embedderOrigin": stored.embedder_origin,
            "landingPath": stored.landing_path,
        }

    @app.get("/api/session/{instance_id}")
    async def session(
        request: Request, instance_id: str, db: Annotated[AsyncSession, Depends(get_db_session)]
    ) -> dict:
        current, _, _ = await authenticate(request, db, instance_id)
        return {"csrfToken": current.csrf_token}

    @app.post("/logout")
    async def logout(
        request: Request, db: Annotated[AsyncSession, Depends(get_db_session)]
    ) -> JSONResponse:
        assert config is not None
        instance = single_header(request, "x-portal-instance")
        if not instance:
            raise fail(401, "SESSION_REQUIRED")
        # Revoked local users may still destroy their existing receiver session.
        current, _ = await session_context(request, db, instance)
        check_csrf(request, current)
        await revoke_session(db, current)
        response = JSONResponse({"code": 200, "msg": "响应成功", "data": None})
        response.delete_cookie(
            COOKIE_NAME,
            path=PREFIX,
            secure=config.cookie_secure,
            httponly=True,
            samesite=config.cookie_samesite,
        )
        return response

    def frontend_index() -> FileResponse:
        index = Path(settings.frontend_dist_path) / "index.html"
        if not settings.serve_frontend or not index.is_file():
            raise fail(503, "RECEIVER_UNAVAILABLE")
        return FileResponse(index, media_type="text/html")

    @app.get("/bootstrap/{instance_id}")
    async def bootstrap(
        request: Request, instance_id: str, db: Annotated[AsyncSession, Depends(get_db_session)]
    ) -> FileResponse:
        await authenticate(request, db, instance_id)
        return frontend_index()

    @app.get("/workbench")
    async def workbench() -> FileResponse:
        # Fragment instance id is available only in the browser. The rendered shell
        # contains no identity/data; its context/session/API calls authenticate it.
        return frontend_index()

    return app
