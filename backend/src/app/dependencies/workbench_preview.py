"""Read-only effective identity, layered after the existing login dependency."""

import logging
from dataclasses import replace
from typing import Annotated

from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db_session
from app.dependencies.workbench_user import (
    WorkbenchUser,
    get_current_workbench_user,
    resolve_workbench_permission,
)
from app.portal_embed.config import normalized_email

logger = logging.getLogger(__name__)


async def get_effective_workbench_user(
    request: Request,
    response: Response,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    actor: Annotated[WorkbenchUser, Depends(get_current_workbench_user)],
) -> WorkbenchUser:
    """Authenticate the real actor on every request before applying a preview.

    The original dependency is still overridden only by the Portal receiver, so
    a preview header can never replace its cookie or create a target session.
    """
    targets = request.headers.getlist("X-Preview-User-Email")
    if not targets:
        return actor
    if actor.role != "admin" or actor.preview_actor_email is not None:
        raise HTTPException(403, "仅管理员可模拟用户视角")
    if len(targets) != 1:
        raise HTTPException(400, "模拟用户邮箱无效")
    try:
        target_email = normalized_email(targets[0].strip())
    except ValueError:
        raise HTTPException(400, "模拟用户邮箱无效") from None
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        raise HTTPException(403, "模拟用户视角仅供查看，请退出模拟后操作")
    target = await resolve_workbench_permission(session, target_email)
    response.headers["Cache-Control"] = "no-store"
    logger.info(
        "Workbench user preview actor=%s target=%s method=%s path=%s",
        actor.email, target.email, request.method, request.url.path,
    )
    return replace(
        target, preview_actor_email=actor.email, preview_actor_label=actor.display_name,
    )
