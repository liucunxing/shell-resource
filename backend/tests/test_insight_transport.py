"""Transient retries remain bounded and never expose provider bodies in logs."""

import logging
from time import perf_counter

import httpx
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.core.config import Settings
from test_insight import service


@pytest.mark.asyncio
@pytest.mark.parametrize("status,expected_calls", [(429, 2), (503, 2), (400, 1), (401, 1)])
async def test_provider_retry_is_bounded_and_does_not_log_sensitive_body(
    monkeypatch, caplog, status, expected_calls
):
    insight, _ = service()
    calls = []

    async def failing(_):
        calls.append(1)
        response = httpx.Response(
            status,
            text="PRIVATE_PROVIDER_BODY",
            headers={"x-request-id": "safe-request-1"},
            request=httpx.Request("POST", "https://example.invalid"),
        )
        cause = httpx.HTTPStatusError(
            "PRIVATE_PROVIDER_BODY", request=response.request, response=response
        )
        raise HTTPException(502, "生成失败") from cause

    monkeypatch.setattr(insight, "_call_model_once", failing)
    with caplog.at_level(logging.WARNING), pytest.raises(HTTPException):
        await insight._call_model({})
    assert len(calls) == expected_calls
    assert "PRIVATE_PROVIDER_BODY" not in caplog.text
    assert "safe-request-1" in caplog.text


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "failure", [httpx.ConnectError, httpx.ReadTimeout, httpx.RemoteProtocolError, httpx.PoolTimeout]
)
async def test_transient_failure_can_recover_and_reports_attempt_count(monkeypatch, failure):
    insight, _ = service()
    calls = []

    async def request(_):
        calls.append(1)
        if len(calls) == 1:
            raise HTTPException(502, "生成失败") from failure("temporary")
        return {"ok": True}, {"total_tokens": 12}

    monkeypatch.setattr(insight, "_call_model_once", request)
    result, usage = await insight._call_model({})
    assert result == {"ok": True}
    assert usage["transport_attempts"] == 2


@pytest.mark.asyncio
async def test_near_deadline_does_not_start_another_transport_attempt(monkeypatch):
    insight, _ = service()
    insight._deadline_at = perf_counter() + 4
    calls = []

    async def failing(_):
        calls.append(1)
        raise HTTPException(502, "生成失败") from httpx.RemoteProtocolError("temporary")

    monkeypatch.setattr(insight, "_call_model_once", failing)
    with pytest.raises(HTTPException):
        await insight._call_model({})
    assert len(calls) == 1


@pytest.mark.parametrize(
    "field,value",
    [
        ("insight_investment_increase_multiple", 1),
        ("insight_investment_decrease_multiple", 1),
        ("insight_investment_absolute_change", -1),
        ("insight_investment_absolute_change", float("nan")),
    ],
)
def test_investment_config_rejects_undefined_thresholds(field, value):
    with pytest.raises(ValidationError):
        Settings(app_env="test", database_url="sqlite+aiosqlite://", **{field: value})
