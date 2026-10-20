"""Transient retries remain bounded and never expose provider bodies in logs."""

import json
import logging
from time import perf_counter
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.core.config import Settings
from test_insight import service


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["eof", "malformed_sse", "invalid_json", "reset"])
async def test_broken_stream_recovers_using_complete_json(monkeypatch, caplog, failure):
    insight, repository = service()
    insight.settings.ai_api_key = SimpleNamespace(get_secret_value=lambda: "PRIVATE_KEY")
    insight.settings.ai_base_url = "https://example.test/v1"
    requests = []

    class BrokenStream(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b'data: {"id":"request-1","choices":[{"delta":{"content":"{"}}]}\n\n'
            raise httpx.RemoteProtocolError("PRIVATE_NETWORK_BODY")

    def respond(request):
        requests.append(json.loads(request.content))
        if len(requests) == 2:
            return httpx.Response(
                200,
                json={
                    "choices": [{"message": {"content": '{"ok":true}'}, "finish_reason": "stop"}],
                    "usage": {"total_tokens": 3},
                },
            )
        if failure == "reset":
            return httpx.Response(
                200, stream=BrokenStream(), headers={"content-type": "text/event-stream"}
            )
        frame = {"id": "request-1", "choices": [{"delta": {"content": "PRIVATE_PARTIAL"}}]}
        if failure == "invalid_json":
            frame["choices"][0]["finish_reason"] = "stop"
        stream = "data: " + ("{" if failure == "malformed_sse" else json.dumps(frame)) + "\n\n"
        return httpx.Response(200, text=stream, headers={"content-type": "text/event-stream"})

    original = httpx.AsyncClient
    monkeypatch.setattr(
        httpx, "AsyncClient", lambda **kw: original(transport=httpx.MockTransport(respond), **kw)
    )
    with caplog.at_level(logging.WARNING):
        result, usage = await insight._call_model({"messages": []})
    assert result == {"ok": True}
    assert [r["stream"] for r in requests] == [True, False]
    assert "stream_options" not in requests[1]
    assert usage["transport_attempts"] == 2
    assert usage["response_diagnostics"]["mode"] == "json"
    assert usage["response_diagnostics"]["finish_reason"] == "stop"
    assert repository.records == []  # Transport cannot save unvalidated partial content.
    assert all(
        secret not in caplog.text
        for secret in ("PRIVATE_KEY", "PRIVATE_PARTIAL", "PRIVATE_NETWORK_BODY")
    )
    assert '"content_bytes"' in caplog.text


@pytest.mark.asyncio
@pytest.mark.parametrize("finish", ["length", "content_filter"])
async def test_nontransient_finish_is_classified_without_retry(monkeypatch, caplog, finish):
    insight, _ = service()
    insight.settings.ai_api_key = SimpleNamespace(get_secret_value=lambda: "test")
    insight.settings.ai_base_url = "https://example.test/v1"
    requests = []

    def respond(request):
        requests.append(request)
        data = {
            "id": "provider-123",
            "choices": [{"delta": {"content": "PRIVATE_PARTIAL"}, "finish_reason": finish}],
        }
        return httpx.Response(
            200,
            text="data: " + json.dumps(data) + "\n\ndata: [DONE]\n\n",
            headers={"content-type": "text/event-stream"},
        )

    original = httpx.AsyncClient
    monkeypatch.setattr(
        httpx, "AsyncClient", lambda **kw: original(transport=httpx.MockTransport(respond), **kw)
    )
    with caplog.at_level(logging.WARNING), pytest.raises(HTTPException) as caught:
        await insight._call_model({})
    assert len(requests) == 1
    assert caught.value.model_diagnostics["finish_reason"] == finish
    assert caught.value.model_diagnostics["done_received"] is True
    assert ("output_limit" if finish == "length" else "content_filter") in caplog.text
    assert "provider-123" in caplog.text
    assert "PRIVATE_PARTIAL" not in caplog.text


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
async def test_incomplete_response_gets_one_bounded_retry(monkeypatch):
    insight, _ = service()
    calls = []

    async def request(_):
        calls.append(1)
        if len(calls) == 1:
            raise HTTPException(502, "生成失败") from ValueError("incomplete model stream")
        return {"ok": True}, {}

    monkeypatch.setattr(insight, "_call_model_once", request)
    result, usage = await insight._call_model({})
    assert result == {"ok": True}
    assert len(calls) == usage["transport_attempts"] == 2


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
