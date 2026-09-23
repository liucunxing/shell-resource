import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)


def _error_payload(code: int, msg: str, data: Any = None) -> dict[str, Any]:
    return {"code": code, "msg": msg, "data": data}


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        message = str(exc.detail) if exc.detail else "请求失败"
        return JSONResponse(
            status_code=exc.status_code,
            content=_error_payload(exc.status_code, message),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content=_error_payload(
                422,
                "请求参数校验失败",
                {"errors": jsonable_encoder(exc.errors(), custom_encoder={ValueError: str})},
            ),
        )

    @app.exception_handler(SQLAlchemyError)
    async def database_exception_handler(request: Request, exc: SQLAlchemyError) -> JSONResponse:
        # Driver exceptions can contain SQL values. Do not expose them in logs or responses.
        logger.warning("Database unavailable on %s (%s)", request.url.path, type(exc).__name__)
        return JSONResponse(
            status_code=503,
            content=_error_payload(503, "数据库暂不可用，请检查连接与表结构后重试"),
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled error on %s", request.url.path, exc_info=exc)
        return JSONResponse(
            status_code=500,
            content=_error_payload(500, "服务器内部错误"),
        )
