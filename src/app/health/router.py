from fastapi import APIRouter

from app.core.config import get_settings
from app.core.responses import ApiResponse, success
from app.schemas.vo.health import HealthVO

router = APIRouter(tags=["Health"])


@router.get("/health", response_model=ApiResponse[HealthVO], summary="应用存活检查")
async def health() -> ApiResponse[HealthVO]:
    settings = get_settings()
    return success(
        HealthVO(
            status="ok",
            service=settings.app_name,
            version=settings.app_version,
            environment=settings.app_env,
        )
    )

