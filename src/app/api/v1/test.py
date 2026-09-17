from fastapi import APIRouter

from app.core.responses import ApiResponse, success
from app.schemas.dto.test import EchoDTO
from app.schemas.vo.test import EchoVO, PingVO
from app.services.test_service import TestService

router = APIRouter()
service = TestService()


@router.get(
    "/ping",
    response_model=ApiResponse[PingVO],
    summary="测试后端是否正常运行",
)
async def ping() -> ApiResponse[PingVO]:
    return success(service.ping())


@router.post(
    "/echo",
    response_model=ApiResponse[EchoVO],
    summary="测试请求体和统一响应体",
)
async def echo(payload: EchoDTO) -> ApiResponse[EchoVO]:
    return success(service.echo(payload))

