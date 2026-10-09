"""Verify that a BaiLian OpenAI-compatible chat endpoint can reply.

Required environment variables:
    BAILIAN_API_KEY
    BAILIAN_BASE_URL

Optional environment variable:
    BAILIAN_MODEL (defaults to qwen-plus)
"""

from __future__ import annotations

import asyncio
import json
import os
import sys

import httpx


def required_environment(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


async def main() -> int:
    api_key = required_environment("BAILIAN_API_KEY")
    base_url = required_environment("BAILIAN_BASE_URL").rstrip("/")
    model = os.getenv("BAILIAN_MODEL", "qwen-plus").strip() or "qwen-plus"
    endpoint = (
        base_url if base_url.endswith("/chat/completions") else f"{base_url}/chat/completions"
    )

    request = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": "请只回复：连接成功",
            }
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                endpoint,
                headers={"Authorization": f"Bearer {api_key}"},
                json=request,
            )
            response.raise_for_status()
            payload = response.json()
        reply = str(payload["choices"][0]["message"]["content"]).strip()
        if not reply:
            raise ValueError("The model returned an empty reply")
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as exc:
        print(f"Connection failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    print(f"Connection succeeded. model={model}")
    print(f"Model reply: {json.dumps(reply, ensure_ascii=True)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
