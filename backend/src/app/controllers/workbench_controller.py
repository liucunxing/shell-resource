from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.responses import ApiResponse, success
from app.db.session import get_db_session
from app.dependencies.storage import get_workbench_blob_storage
from app.dependencies.workbench_user import WorkbenchUser, get_current_workbench_user
from app.repositories.budget_repository import BudgetDistributorRepository, BudgetRepository
from app.schemas.dto.workbench import (
    DistributorAllocationCreateDTO,
    DistributorAllocationUpdateDTO,
)
from app.schemas.vo.workbench import (
    DistributorAllocationVO,
    DistributorImportVO,
    InitiativeBudgetSummaryVO,
    MyWorkbenchVO,
)
from app.services.workbench_service import WorkbenchService
from app.storage.azure_blob import AzureBlobStorage

router = APIRouter()


def _workbench_service(session: AsyncSession, user: WorkbenchUser) -> WorkbenchService:
    return WorkbenchService(
        budget_repository=BudgetRepository(session),
        distributor_repository=BudgetDistributorRepository(session),
        user=user,
    )


@router.get(
    "/my-initiatives",
    response_model=ApiResponse[MyWorkbenchVO],
    summary="获取当前用户的 Initiative 工作台",
)
async def get_my_initiatives(
    session: Annotated[AsyncSession, Depends(get_db_session)],
    user: Annotated[WorkbenchUser, Depends(get_current_workbench_user)],
    initiative_keyword: Annotated[str | None, Query(max_length=255)] = None,
    resource_type_keyword: Annotated[str | None, Query(max_length=64)] = None,
    status_value: Annotated[int | None, Query(alias="status", ge=0, le=1)] = None,
) -> ApiResponse[MyWorkbenchVO]:
    service = _workbench_service(session, user)
    return success(
        await service.get_my_workbench(
            initiative_keyword=initiative_keyword,
            resource_type_keyword=resource_type_keyword,
            status_value=status_value,
        )
    )


@router.get(
    "/initiatives/{budget_id}/distributor-allocations",
    response_model=ApiResponse[list[DistributorAllocationVO]],
    summary="获取 Initiative 的经销商分配列表",
)
async def list_distributor_allocations(
    budget_id: int,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    user: Annotated[WorkbenchUser, Depends(get_current_workbench_user)],
) -> ApiResponse[list[DistributorAllocationVO]]:
    return success(await _workbench_service(session, user).list_distributor_allocations(budget_id))


@router.post(
    "/initiatives/{budget_id}/distributor-allocations",
    response_model=ApiResponse[DistributorAllocationVO],
    summary="新增 Initiative 的经销商分配",
)
async def create_distributor_allocation(
    budget_id: int,
    payload: DistributorAllocationCreateDTO,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    user: Annotated[WorkbenchUser, Depends(get_current_workbench_user)],
) -> ApiResponse[DistributorAllocationVO]:
    return success(
        await _workbench_service(session, user).create_distributor_allocation(
            budget_id=budget_id,
            payload=payload,
        ),
        msg="新增成功",
    )


@router.patch(
    "/initiatives/{budget_id}/distributor-allocations/{allocation_id}",
    response_model=ApiResponse[DistributorAllocationVO],
    summary="修改 Initiative 的经销商分配",
)
async def update_distributor_allocation(
    budget_id: int,
    allocation_id: int,
    payload: DistributorAllocationUpdateDTO,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    user: Annotated[WorkbenchUser, Depends(get_current_workbench_user)],
) -> ApiResponse[DistributorAllocationVO]:
    return success(
        await _workbench_service(session, user).update_distributor_allocation(
            budget_id=budget_id,
            allocation_id=allocation_id,
            payload=payload,
        ),
        msg="修改成功",
    )


@router.delete(
    "/initiatives/{budget_id}/distributor-allocations/{allocation_id}",
    response_model=ApiResponse[None],
    summary="删除 Initiative 的经销商分配",
)
async def delete_distributor_allocation(
    budget_id: int,
    allocation_id: int,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    user: Annotated[WorkbenchUser, Depends(get_current_workbench_user)],
) -> ApiResponse[None]:
    await _workbench_service(session, user).delete_distributor_allocation(
        budget_id=budget_id,
        allocation_id=allocation_id,
    )
    return success(msg="删除成功")


@router.get(
    "/initiatives/{budget_id}/budget-summary",
    response_model=ApiResponse[InitiativeBudgetSummaryVO],
    summary="获取 Initiative 预算、已分配金额与未解释差额",
)
async def get_budget_summary(
    budget_id: int,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    user: Annotated[WorkbenchUser, Depends(get_current_workbench_user)],
) -> ApiResponse[InitiativeBudgetSummaryVO]:
    return success(await _workbench_service(session, user).get_budget_summary(budget_id))


@router.get(
    "/distributor-allocation-template",
    summary="下载经销商分配导入模板",
    response_class=StreamingResponse,
)
async def download_distributor_allocation_template(
    storage: Annotated[AzureBlobStorage, Depends(get_workbench_blob_storage)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> StreamingResponse:
    blob_name, data, content_type = await WorkbenchService.download_import_template(
        storage=storage,
        settings=settings,
    )
    return StreamingResponse(
        iter([data]),
        media_type=content_type,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(blob_name)}",
        },
    )


@router.post(
    "/initiatives/{budget_id}/distributor-allocations/import",
    response_model=ApiResponse[DistributorImportVO],
    summary="批量导入 Initiative 的经销商分配",
)
async def import_distributor_allocations(
    budget_id: int,
    file: Annotated[UploadFile, File(description="经销商分配 .xlsx 文件")],
    settings: Annotated[Settings, Depends(get_settings)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    user: Annotated[WorkbenchUser, Depends(get_current_workbench_user)],
) -> ApiResponse[DistributorImportVO]:
    return success(
        await _workbench_service(session, user).import_distributor_allocations(
            budget_id=budget_id,
            file=file,
            max_upload_bytes=settings.azure_blob_max_upload_bytes,
        ),
        msg="全部导入完成",
    )
