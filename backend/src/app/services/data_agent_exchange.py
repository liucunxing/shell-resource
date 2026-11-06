"""Exchange a server-authenticated email for the corresponding vendor iframe URL."""

import asyncio
import json
from urllib.parse import urlencode

import httpx
from fastapi import HTTPException

from app.portal_embed.config import normalized_email
from app.portal_embed.verifier import validate_address


def _safe_parameter(value: object, limit: int) -> bool:
    return (
        isinstance(value, str)
        and 0 < len(value) <= limit
        and value.isprintable()
        and not any(char.isspace() for char in value)
    )


async def _read_vendor_json(response: httpx.Response) -> object:
    if response.headers.get("content-encoding", "identity").lower() != "identity":
        raise ValueError
    body = bytearray()
    async for chunk in response.aiter_bytes(chunk_size=8192):
        if len(body) + len(chunk) > 65536:
            raise ValueError
        body.extend(chunk)
    return json.loads(body)


def _literal_ilike(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _directory_identity(payload: object, email: str) -> tuple[str, int]:
    if not isinstance(payload, dict):
        raise ValueError
    users, meta = payload.get("data"), payload.get("meta")
    if not isinstance(users, list) or not isinstance(meta, dict):
        raise ValueError
    count, page, page_size, total_page = (
        meta.get(key) for key in ("count", "page", "pageSize", "totalPage")
    )
    if (
        type(count) is not int
        or type(page) is not int
        or type(page_size) is not int
        or type(total_page) is not int
    ):
        raise ValueError
    if (
        count < 0
        or page != 1
        or page_size != 2
        or total_page != (count + 1) // 2
        or len(users) != min(count, 2)
    ):
        raise ValueError
    for user in users:
        if (
            not isinstance(user, dict)
            or type(user.get("id")) is not int
            or user["id"] <= 0
            or normalized_email(user.get("email")) != email
        ):
            raise ValueError
    if count == 0:
        raise HTTPException(403, "当前邮箱尚未开通 Data Agent 账号")
    if count > 1:
        raise HTTPException(502, "Data Agent 邮箱对应多个账号，请联系管理员")
    return users[0]["email"], users[0]["id"]


async def exchange_data_agent_ticket(
    *, email: str, origin: str, api_token: str, space: str = "default"
) -> str:
    """Caller owns identity and authorization checks. The returned URL is a credential."""
    origin = origin.removesuffix("/")
    try:
        validate_address(origin, allow_loopback_http=False, origin_only=True)
    except ValueError:
        raise HTTPException(503, "问数服务配置不可用") from None
    if (
        not _safe_parameter(api_token, 16000)
        or not api_token.isascii()
        or not _safe_parameter(space, 128)
        or not space.isascii()
    ):
        raise HTTPException(503, "问数服务配置不可用")
    try:
        email = normalized_email(email)
    except ValueError:
        raise HTTPException(403, "缺少有效的问数登录身份") from None

    headers = {
        "Authorization": f"Bearer {api_token}",
        "Referer": f"{origin}/",
        "Accept-Encoding": "identity",
        "x-spaces": space,
    }
    try:
        async with (
            asyncio.timeout(20),
            httpx.AsyncClient(timeout=20, follow_redirects=False, trust_env=False) as client,
        ):
            # The vendor issues by exact email, while our identity contract ignores case.
            # Resolve its original spelling without creating users or changing access.
            async with client.stream(
                "GET",
                f"{origin}/api/users:list",
                params={
                    "page": 1,
                    "pageSize": 2,
                    "fields[]": ["id", "email"],
                    "filter": json.dumps({"email": {"$iLike": _literal_ilike(email)}}),
                },
                headers=headers,
            ) as response:
                if response.status_code != 200:
                    raise HTTPException(502, "无法查询 Data Agent 账号目录")
                directory_email, user_id = _directory_identity(
                    await _read_vendor_json(response), email
                )
            async with client.stream(
                "POST",
                f"{origin}/api/yiaskAuth:issueUserToken",
                json={"email": directory_email},
                headers=headers,
            ) as response:
                if response.status_code != 200:
                    raise HTTPException(502, "问数服务未签发登录凭据")
                result = await _read_vendor_json(response)
        if isinstance(result, dict) and isinstance(result.get("data"), dict):
            result = result["data"]
        if not isinstance(result, dict) or not isinstance(result.get("user"), dict):
            raise ValueError
        token = result.get("token")
        if (
            not _safe_parameter(token, 16000)
            or normalized_email(result["user"].get("email")) != email
            or type(result["user"].get("id")) is not int
            or result["user"]["id"] != user_id
        ):
            raise ValueError
        iframe_url = f"{origin}/admin/chat?" + urlencode({"token": token, "space": space})
        if len(iframe_url) > 65536:
            raise ValueError
        return iframe_url
    except (httpx.HTTPError, TimeoutError, ValueError, RecursionError):
        raise HTTPException(502, "无法取得当前用户的问数登录凭据") from None
