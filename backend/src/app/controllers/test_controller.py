from typing import Annotated

from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.responses import ApiResponse, success
from app.db.session import get_db_session
from app.dependencies.storage import get_blob_storage
from app.repositories.test_table_repository import TestTableRepository
from app.schemas.dto.test import EchoDTO
from app.schemas.vo.blob import BlobUploadVO
from app.schemas.vo.test import EchoVO, PingVO
from app.schemas.vo.test_table import TestTableValueVO
from app.services.blob_test_service import BlobTestService
from app.services.test_service import TestService
from app.services.test_table_service import TestTableService
from app.storage.azure_blob import AzureBlobStorage

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


@router.get(
    "/database-value",
    response_model=ApiResponse[TestTableValueVO],
    summary="测试从 PostgreSQL DO 层到统一接口响应的完整链路",
)
async def database_value(
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> ApiResponse[TestTableValueVO]:
    repository = TestTableRepository(session)
    database_service = TestTableService(repository)
    return success(await database_service.get_first_value())


@router.post(
    "/blob/upload",
    response_model=ApiResponse[BlobUploadVO],
    summary="测试上传文件到 Azure Blob Storage",
)
async def upload_blob(
    file: Annotated[UploadFile, File(description="要上传到测试容器的文件")],
    storage: Annotated[AzureBlobStorage, Depends(get_blob_storage)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ApiResponse[BlobUploadVO]:
    blob_service = BlobTestService(storage, settings.azure_blob_max_upload_bytes)
    return success(await blob_service.upload(file), msg="文件上传成功")
