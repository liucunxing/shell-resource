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
    }
    try:
        async with (
            asyncio.timeout(20),
            httpx.AsyncClient(timeout=20, follow_redirects=False, trust_env=False) as client,
            client.stream(
                "POST",
                f"{origin}/api/yiaskAuth:issueUserToken",
                json={"email": email},
                headers=headers,
            ) as response,
        ):
            if response.status_code != 200:
                raise HTTPException(502, "问数服务未签发登录凭据")
            if response.headers.get("content-encoding", "identity").lower() != "identity":
                raise ValueError
            body = bytearray()
            async for chunk in response.aiter_bytes(chunk_size=8192):
                if len(body) + len(chunk) > 65536:
                    raise ValueError
                body.extend(chunk)
        result = json.loads(body)
        if isinstance(result, dict) and isinstance(result.get("data"), dict):
            result = result["data"]
        if not isinstance(result, dict) or not isinstance(result.get("user"), dict):
            raise ValueError
        token = result.get("token")
        if (
            not _safe_parameter(token, 16000)
            or normalized_email(result["user"].get("email")) != email
        ):
            raise ValueError
        iframe_url = f"{origin}/admin/chat?" + urlencode({"token": token, "space": space})
        if len(iframe_url) > 65536:
            raise ValueError
        return iframe_url
    except (httpx.HTTPError, TimeoutError, ValueError, RecursionError):
        raise HTTPException(502, "无法取得当前用户的问数登录凭据") from None
