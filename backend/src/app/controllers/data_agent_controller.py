from secrets import compare_digest
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.responses import ApiResponse, success
from app.db.session import get_db_session
from app.dependencies.workbench_user import (
    WorkbenchUser,
    get_current_workbench_user,
    resolve_workbench_permission,
)
from app.portal_embed.config import normalized_email
from app.services.data_agent_exchange import exchange_data_agent_ticket

router = APIRouter()


def _require_verified_email(request: Request, settings: Settings, email: str) -> None:
    # The authenticated ingress strips client-supplied headers before setting both values.
    key = settings.data_agent_ingress_key
    secret = key.get_secret_value() if key else ""
    if len(secret) < 32 or not secret.isascii() or not secret.isprintable() or (
        "," in secret or any(char.isspace() for char in secret)
    ):
        raise HTTPException(503, "工作台尚未配置可信问数入口")
    keys = request.headers.getlist("X-Resource-Ingress-Key")
    emails = request.headers.getlist("X-Resource-Verified-Email")
    if (
        len(keys) != 1 or len(emails) != 1 or len(request.headers.getlist("X-User-Email")) != 1
        or not keys[0].isascii() or not compare_digest(keys[0], secret)
    ):
        raise HTTPException(403, "请从已验证身份的帆软入口打开问数")
    try:
        verified = normalized_email(emails[0].strip())
    except ValueError:
        raise HTTPException(403, "请从已验证身份的帆软入口打开问数") from None
    if verified != email.lower():
        raise HTTPException(403, "帆软身份与工作台账号不一致")


@router.post("/data-agent/launch", response_model=ApiResponse[dict[str, str]])
async def launch_data_agent(
    request: Request,
    response: Response,
    user: Annotated[WorkbenchUser, Depends(get_current_workbench_user)],
    settings: Annotated[Settings, Depends(get_settings)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> ApiResponse[dict[str, str]]:
    """Use the workbench-resolved identity for the limited FineReport UAT entry."""
    if settings.app_env == "production":
        raise HTTPException(401, "生产环境需要可信身份认证")
    if request.query_params:
        raise HTTPException(400, "问数入口不接收查询参数")
    async for chunk in request.stream():
        if chunk:
            raise HTTPException(400, "问数入口不接收请求体")
    if not settings.data_agent_base_url or not settings.data_agent_api_token:
        raise HTTPException(503, "工作台尚未配置问数服务")
    _require_verified_email(request, settings, user.email)
    if user.email.lower() not in settings.data_agent_uat_emails:
        raise HTTPException(403, "当前工作台账号未开通问数测试权限")
    url = await exchange_data_agent_ticket(
        email=user.email,
        origin=settings.data_agent_base_url,
        api_token=settings.data_agent_api_token.get_secret_value(),
        space=settings.data_agent_space,
    )
    # A permission may be revoked while waiting for the vendor.
    await resolve_workbench_permission(session, user.email)
    response.headers["Cache-Control"] = "no-store"
    return success({"iframeUrl": url})
