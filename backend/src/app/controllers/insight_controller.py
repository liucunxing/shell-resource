from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.responses import ApiResponse, success
from app.db.session import get_db_session
from app.dependencies.workbench_user import WorkbenchUser, get_current_workbench_user
from app.schemas.dto.insight import InsightGenerateDTO, InsightPreviewDTO, InsightPromptUpdateDTO
from app.schemas.vo.insight import InsightPromptVO, InsightReadVO
from app.services.insight_preview_service import InsightPreviewService
from app.services.insight_service import InsightService

router = APIRouter()


@router.get("/insights/preview", response_model=ApiResponse[dict], summary="管理员读取试用视角")
async def insight_preview_context(
    session: Annotated[AsyncSession, Depends(get_db_session)],
    user: Annotated[WorkbenchUser, Depends(get_current_workbench_user)],
    settings: Annotated[Settings, Depends(get_settings)],
    user_email: Annotated[str, Query(min_length=1, max_length=254)],
    planning_year: Annotated[int, Query(ge=2000, le=2100)],
) -> ApiResponse[dict]:
    service = await InsightPreviewService.create(session, user, user_email, settings)
    return success(await service.context(planning_year))


@router.post("/insights/preview", response_model=ApiResponse[dict], summary="管理员试用用户Insight")
async def generate_insight_preview(
    payload: InsightPreviewDTO,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    user: Annotated[WorkbenchUser, Depends(get_current_workbench_user)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ApiResponse[dict]:
    service = await InsightPreviewService.create(session, user, payload.user_email, settings)
    return success(await service.generate(
        scope=payload.scope, planning_year=payload.planning_year, preset_id=payload.preset_id
    ), msg="试用分析已生成，未保存到用户记录")


def _service(session: AsyncSession, user: WorkbenchUser, settings: Settings) -> InsightService:
    return InsightService(session=session, user=user, settings=settings)


@router.get("/insights", response_model=ApiResponse[InsightReadVO], summary="读取 Insight")
async def get_insight(
    session: Annotated[AsyncSession, Depends(get_db_session)],
    user: Annotated[WorkbenchUser, Depends(get_current_workbench_user)],
    settings: Annotated[Settings, Depends(get_settings)],
    scope: Annotated[str, Query(min_length=1, max_length=300)],
    planning_year: Annotated[int, Query(ge=2000, le=2100)],
    preset_id: str = "comprehensive",
) -> ApiResponse[InsightReadVO]:
    data = await _service(session, user, settings).get_insight(
        scope=scope, planning_year=planning_year, preset_id=preset_id
    )
    return success(InsightReadVO.model_validate(data))


@router.put(
    "/insights/prompt", response_model=ApiResponse[InsightPromptVO], summary="更新 Insight 提示词"
)
async def update_insight_prompt(
    payload: InsightPromptUpdateDTO,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    user: Annotated[WorkbenchUser, Depends(get_current_workbench_user)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ApiResponse[InsightPromptVO]:
    data = await _service(session, user, settings).update_prompt(
        scope=payload.scope,
        planning_year=payload.planning_year,
        text=payload.text,
        expected_version=payload.expected_version,
    )
    return success(InsightPromptVO.model_validate(data), msg="分析提示词已保存")


@router.post("/insights/generate", response_model=ApiResponse[dict], summary="生成 Insight")
async def generate_insight(
    payload: InsightGenerateDTO,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    user: Annotated[WorkbenchUser, Depends(get_current_workbench_user)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ApiResponse[dict]:
    return success(
        await _service(session, user, settings).generate(
            scope=payload.scope, planning_year=payload.planning_year, preset_id=payload.preset_id
        ),
        msg="Insight 已生成",
    )
