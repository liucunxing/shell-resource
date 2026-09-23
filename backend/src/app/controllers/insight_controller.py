from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.responses import ApiResponse, success
from app.db.session import get_db_session
from app.dependencies.workbench_user import WorkbenchUser, get_current_workbench_user
from app.schemas.dto.insight import InsightGenerateDTO, InsightPromptUpdateDTO
from app.schemas.vo.insight import InsightPromptVO, InsightReadVO
from app.services.insight_service import InsightService

router = APIRouter()


def _service(session: AsyncSession, user: WorkbenchUser, settings: Settings) -> InsightService:
    return InsightService(session=session, user=user, settings=settings)


@router.get("/insights", response_model=ApiResponse[InsightReadVO], summary="读取六点 Insight")
async def get_insight(
    session: Annotated[AsyncSession, Depends(get_db_session)],
    user: Annotated[WorkbenchUser, Depends(get_current_workbench_user)],
    settings: Annotated[Settings, Depends(get_settings)],
    scope: Annotated[str, Query(min_length=1, max_length=300)],
    planning_year: Annotated[int, Query(ge=2000, le=2100)],
) -> ApiResponse[InsightReadVO]:
    data = await _service(session, user, settings).get_insight(
        scope=scope, planning_year=planning_year
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


@router.post("/insights/generate", response_model=ApiResponse[dict], summary="生成六点 Insight")
async def generate_insight(
    payload: InsightGenerateDTO,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    user: Annotated[WorkbenchUser, Depends(get_current_workbench_user)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ApiResponse[dict]:
    return success(
        await _service(session, user, settings).generate(
            scope=payload.scope, planning_year=payload.planning_year
        ),
        msg="六点 Insight 已生成",
    )
