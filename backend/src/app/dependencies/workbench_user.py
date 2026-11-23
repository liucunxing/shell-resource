from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.exc import MultipleResultsFound
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.departments import departments
from app.core.resource_access import valid_management_sectors
from app.db.session import get_db_session
from app.repositories.workspace_repository import WorkspaceRepository


@dataclass(frozen=True, slots=True)
class WorkbenchUser:
    """Temporary workbench identity until enterprise SSO is available."""

    email: str
    role: str
    department: str | list[str] | tuple[str, ...] | None
    display_name: str
    sectors: tuple[str, ...] = ()
    preview_actor_email: str | None = None
    preview_actor_label: str | None = None
    affiliation_sector: str | None = None
    affiliation_department: str | None = None
    history_resources: tuple[str, ...] | None = None

    @property
    def departments(self) -> tuple[str, ...]:
        return tuple(departments(self.department))

    @property
    def dealer_sectors(self) -> tuple[str, ...] | None:
        """None allows all dealer sectors; an empty tuple allows none."""
        self.require_data_scope()
        return None if self.role == "admin" else self.sectors

    def require_data_scope(self) -> None:
        if self.role == "management" and not valid_management_sectors(self.sectors):
            raise HTTPException(403, "管理层业务线范围未配置或无效，请联系管理员")

    @property
    def owner_id(self) -> str:
        return self.email

    @property
    def user_id(self) -> str:
        return self.email

    @property
    def user_name(self) -> str:
        return self.display_name


async def get_current_workbench_user(
    session: Annotated[AsyncSession, Depends(get_db_session)],
    x_user_email: Annotated[str | None, Header()] = None,
) -> WorkbenchUser:
    """Resolve the development email header against enabled database permission."""
    if get_settings().app_env == "production":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="生产环境需要可信身份认证"
        )
    email = (x_user_email or "").strip().lower()
    if not email:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="缺少 X-User-Email")
    return await resolve_workbench_permission(session, email)


async def resolve_workbench_permission(session: AsyncSession, email: str) -> WorkbenchUser:
    """Permission lookup for an already authenticated or explicitly authorized subject.

    This function is not an HTTP identity dependency. Legacy header authentication
    remains guarded above; Portal authentication owns a separate session dependency.
    """
    email = email.strip().lower()
    try:
        permission = await WorkspaceRepository(session).get_permission(email)
    except MultipleResultsFound:
        raise HTTPException(status_code=403, detail="邮箱权限记录冲突，请联系管理员") from None
    if permission is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="当前邮箱没有工作台权限")
    if permission.role not in {"owner", "lead", "management", "admin"} or (
        permission.role in {"owner", "lead"} and not departments(permission.department)
    ):
        raise HTTPException(status_code=403, detail="用户权限配置无效")
    if permission.role == "management" and not valid_management_sectors(permission.sector):
        raise HTTPException(403, "管理层业务线范围未配置或无效，请联系管理员")
    history_resources: list[str] | None = getattr(permission, "history_resources", None)
    return WorkbenchUser(
        email=permission.email,
        role=permission.role,
        department=permission.department,
        display_name=permission.display_name,
        sectors=tuple(permission.sector or ()),
        affiliation_sector=getattr(permission, "affiliation_sector", None),
        affiliation_department=getattr(permission, "affiliation_department", None),
        history_resources=tuple(history_resources) if history_resources is not None else None,
    )
