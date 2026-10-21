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


def structured_abort_payload(message=None):
    from app.services.insight_service import STRUCTURED_OUTPUT_ABORT_MESSAGE

    return {
        "id": "abort-request-123",
        "error": {
            "code": "invalid_parameter_error",
            "type": "invalid_request_error",
            "message": message if message is not None else STRUCTURED_OUTPUT_ABORT_MESSAGE,
        },
    }


def schema_body():
    return {
        "messages": [{"role": "system", "content": "PRIVATE_PROMPT"}],
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "test",
                "schema": {
                    "type": "object",
                    "required": ["ok"],
                    "properties": {"ok": {"const": True}},
                    "additionalProperties": False,
                },
            },
        },
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("recover", [False, True])
@pytest.mark.parametrize("status", [200, 400])
async def test_json_object_abort_retries_once_without_dropping_contract(
    monkeypatch, recover, status
):
    insight, repository = service()
    insight.settings.ai_api_key = SimpleNamespace(get_secret_value=lambda: "test")
    insight.settings.ai_base_url = "https://example.test/v1"
    calls = []
    body = {
        "messages": [{"role": "system", "content": "JSON contract"}],
        "response_format": {"type": "json_object"},
        "stream": False,
    }

    def respond(request):
        calls.append(json.loads(request.content))
        if recover and len(calls) == 2:
            return httpx.Response(
                200,
                json={
                    "choices": [{"message": {"content": '{"ok":true}'}, "finish_reason": "stop"}]
                },
            )
        return httpx.Response(status, json=structured_abort_payload())

    original = httpx.AsyncClient
    monkeypatch.setattr(
        httpx, "AsyncClient", lambda **kw: original(transport=httpx.MockTransport(respond), **kw)
    )
    if recover:
        result, usage = await insight._call_model(body)
        assert result == {"ok": True} and usage["transport_attempts"] == 2
    else:
        with pytest.raises(HTTPException):
            await insight._call_model(body)
    assert calls == [body, body]
    assert repository.records == []


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["sse", "json", "http"])
async def test_verified_structured_abort_falls_back_once_and_preserves_contract(
    monkeypatch, caplog, mode
):
    insight, repository = service()
    insight.settings.ai_api_key = SimpleNamespace(get_secret_value=lambda: "PRIVATE_KEY")
    insight.settings.ai_base_url = "https://example.test/v1"
    calls = []
    body = schema_body()
    schema = body["response_format"]["json_schema"]["schema"]

    def respond(request):
        calls.append(json.loads(request.content))
        if len(calls) == 1:
            error = structured_abort_payload()
            if mode == "sse":
                partial = {"choices": [{"delta": {"content": "PRIVATE_PARTIAL"}}]}
                return httpx.Response(
                    200,
                    text="data: "
                    + json.dumps(partial)
                    + "\n\n"
                    + "data: "
                    + json.dumps(error)
                    + "\n\n",
                    headers={"content-type": "text/event-stream"},
                )
            return httpx.Response(400 if mode == "http" else 200, json=error)
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": '{"ok":true}'}, "finish_reason": "stop"}]},
        )

    original = httpx.AsyncClient
    monkeypatch.setattr(
        httpx, "AsyncClient", lambda **kw: original(transport=httpx.MockTransport(respond), **kw)
    )
    with caplog.at_level(logging.WARNING):
        result, usage = await insight._call_model(body)
    assert result == {"ok": True} and usage["transport_attempts"] == 2
    fallback = calls[1]
    assert fallback["response_format"] == {"type": "json_object"}
    assert fallback["stream"] is False and "stream_options" not in fallback
    embedded = fallback["messages"][0]["content"].split("JSON Schema: ")[1]
    assert json.loads(embedded) == schema
    assert "structured_output_aborted" in caplog.text and "abort-request-123" in caplog.text
    assert "invalid_parameter_error" in caplog.text and "invalid_request_error" in caplog.text
    assert all(
        value not in caplog.text
        for value in [
            "PRIVATE_KEY",
            "PRIVATE_PROMPT",
            "PRIVATE_PARTIAL",
            structured_abort_payload()["error"]["message"],
        ]
    )
    assert repository.records == []
    # A validation repair reuses this same body without returning to json_schema.
    body["messages"].append({"role": "user", "content": "Repair required fields"})
    await insight._call_model(body)
    assert calls[2]["response_format"] == {"type": "json_object"}
    assert calls[2]["stream"] is False
    assert len([m for m in calls[2]["messages"] if "JSON Schema: " in m["content"]]) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["sse", "json", "http"])
@pytest.mark.parametrize("known", [False, True])
async def test_unknown_parameter_or_exhausted_deadline_never_falls_back(
    monkeypatch, caplog, mode, known
):
    insight, _ = service()
    insight.settings.ai_api_key = SimpleNamespace(get_secret_value=lambda: "PRIVATE_KEY")
    insight.settings.ai_base_url = "https://example.test/v1"
    if known:
        insight._deadline_at = perf_counter() + 4
    calls = []

    def respond(request):
        calls.append(request)
        error = structured_abort_payload(None if known else "PRIVATE_OTHER_PARAMETER_ERROR")
        if mode == "sse":
            return httpx.Response(
                200,
                text="data: " + json.dumps(error) + "\n\n",
                headers={"content-type": "text/event-stream"},
            )
        return httpx.Response(400 if mode == "http" else 200, json=error)

    original = httpx.AsyncClient
    monkeypatch.setattr(
        httpx, "AsyncClient", lambda **kw: original(transport=httpx.MockTransport(respond), **kw)
    )
    body = schema_body()
    with caplog.at_level(logging.WARNING), pytest.raises(HTTPException):
        await insight._call_model(body)
    assert len(calls) == 1
    assert body["response_format"]["type"] == "json_schema"
    assert "PRIVATE_OTHER_PARAMETER_ERROR" not in caplog.text


@pytest.mark.asyncio
async def test_repeated_structured_abort_stops_after_one_fallback(monkeypatch):
    insight, _ = service()
    insight.settings.ai_api_key = SimpleNamespace(get_secret_value=lambda: "test")
    insight.settings.ai_base_url = "https://example.test/v1"
    calls = []

    def respond(request):
        calls.append(request)
        return httpx.Response(200, json=structured_abort_payload())

    original = httpx.AsyncClient
    monkeypatch.setattr(
        httpx, "AsyncClient", lambda **kw: original(transport=httpx.MockTransport(respond), **kw)
    )
    with pytest.raises(HTTPException):
        await insight._call_model(schema_body())
    assert len(calls) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "malformed",
    [
        {"blocks": None},
        {"blocks": [], "checks": 2},
        {"blocks": [], "checks": [{"fact_ids": [None]}]},
    ],
)
async def test_object_fallback_invalid_shape_uses_validation_repair_not_500(monkeypatch, malformed):
    from app.services.insight_pack_adapter import build_evidence
    from test_insight import valid_result, workspace

    insight, repository = service()
    data = workspace()
    evidence = build_evidence(data, insight._scope(data, "initiative:1"), "owner", 2027)
    calls = []

    async def model(body):
        calls.append(body)
        return (malformed if len(calls) == 1 else valid_result(evidence)), {}

    monkeypatch.setattr(insight, "_call_model", model)
    record = await insight.generate(scope="initiative:1", planning_year=2027)
    assert len(calls) == 2 and len(repository.records) == 1
    assert record["metadata"]["attempts"][0]["validation"] == "rejected"
    assert record["metadata"]["attempts"][1]["validation"] == "passed"
