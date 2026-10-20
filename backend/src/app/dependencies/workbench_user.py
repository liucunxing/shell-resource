from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.departments import departments
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

    @property
    def departments(self) -> tuple[str, ...]:
        return tuple(departments(self.department))

    @property
    def dealer_sectors(self) -> tuple[str, ...] | None:
        """None allows all dealer sectors; an empty tuple allows none."""
        return None if self.role in {"admin", "management"} else self.sectors

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
    permission = await WorkspaceRepository(session).get_permission(email)
    if permission is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="当前邮箱没有工作台权限")
    if permission.role not in {"owner", "lead", "management", "admin"} or (
        permission.role in {"owner", "lead"} and not departments(permission.department)
    ):
        raise HTTPException(status_code=403, detail="用户权限配置无效")
    return WorkbenchUser(
        email=permission.email,
        role=permission.role,
        department=permission.department,
        display_name=permission.display_name,
        sectors=tuple(permission.sector or ()),
    )
