"""Version and department workflow endpoints."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.responses import ApiResponse, success
from app.db.session import get_db_session
from app.dependencies.workbench_preview import get_effective_workbench_user
from app.dependencies.workbench_user import WorkbenchUser
from app.schemas.dto.planning import (
    DepartmentActionDTO,
    PlanningVersionCreateDTO,
    PlanningVersionDeleteDTO,
    PlanningVersionReleaseDTO,
    PlanningVersionUpdateDTO,
    VersionInitiativeDTO,
    VersionInitiativesImportDTO,
)
from app.services.planning_service import PlanningService, version_view

router = APIRouter()
Session = Annotated[AsyncSession, Depends(get_db_session)]
User = Annotated[WorkbenchUser, Depends(get_effective_workbench_user)]


@router.get("/planning-versions", response_model=ApiResponse[list[dict]])
async def list_versions(
    session: Session, user: User, planning_year: int = Query(ge=2020, le=2100)
) -> ApiResponse[list[dict]]:
    return success(
        [version_view(v) for v in await PlanningService(session, user).versions(planning_year)]
    )


@router.post("/planning-versions", response_model=ApiResponse[dict])
async def create_version(
    payload: PlanningVersionCreateDTO, session: Session, user: User
) -> ApiResponse[dict]:
    return success(await PlanningService(session, user).create(payload))


@router.patch("/planning-versions/{version_id}", response_model=ApiResponse[dict])
async def update_version(
    version_id: str, payload: PlanningVersionUpdateDTO, session: Session, user: User
) -> ApiResponse[dict]:
    return success(await PlanningService(session, user).update(version_id, payload))


@router.post("/planning-versions/{version_id}/release", response_model=ApiResponse[dict])
async def release_version(
    version_id: str, payload: PlanningVersionReleaseDTO, session: Session, user: User
) -> ApiResponse[dict]:
    return success(await PlanningService(session, user).release(version_id, payload))


@router.get("/planning-versions/{version_id}/deletion-info", response_model=ApiResponse[dict])
async def version_deletion_info(version_id: str, session: Session, user: User) -> ApiResponse[dict]:
    return success(await PlanningService(session, user).deletion_info(version_id))


@router.post("/planning-versions/{version_id}/delete", response_model=ApiResponse[dict])
async def delete_version(
    version_id: str, payload: PlanningVersionDeleteDTO, session: Session, user: User
) -> ApiResponse[dict]:
    return success(await PlanningService(session, user).delete(version_id, payload))


@router.get("/planning-versions/{version_id}/department", response_model=ApiResponse[dict])
async def department(
    version_id: str, sector: str, department: str, session: Session, user: User
) -> ApiResponse[dict]:
    return success(await PlanningService(session, user).department(version_id, sector, department))


@router.post(
    "/planning-versions/{version_id}/department/{action}", response_model=ApiResponse[dict]
)
async def department_action(
    version_id: str,
    action: Literal["confirm", "withdraw"],
    payload: DepartmentActionDTO,
    session: Session,
    user: User,
) -> ApiResponse[dict]:
    return success(
        await PlanningService(session, user).department_action(version_id, action, payload)
    )


@router.post("/planning-versions/{version_id}/initiatives", response_model=ApiResponse[dict])
async def create_initiative(
    version_id: str, payload: VersionInitiativeDTO, session: Session, user: User
) -> ApiResponse[dict]:
    return success(await PlanningService(session, user).edit_initiative(version_id, None, payload))


@router.post("/planning-versions/{version_id}/initiatives/import", response_model=ApiResponse[dict])
async def import_initiatives(
    version_id: str, payload: VersionInitiativesImportDTO, session: Session, user: User,
) -> ApiResponse[dict]:
    return success(await PlanningService(session, user).import_initiatives(version_id, payload))


@router.put(
    "/planning-versions/{version_id}/initiatives/{budget_id}", response_model=ApiResponse[dict]
)
async def edit_initiative(
    version_id: str, budget_id: int, payload: VersionInitiativeDTO, session: Session, user: User
) -> ApiResponse[dict]:
    return success(
        await PlanningService(session, user).edit_initiative(version_id, budget_id, payload)
    )
