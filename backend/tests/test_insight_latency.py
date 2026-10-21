"""The production generation boundary, including repair, has one shared deadline."""

import asyncio

import pytest
from fastapi import HTTPException

from app.services.insight_pack_adapter import build_evidence
from test_insight import service, valid_result, workspace


@pytest.mark.asyncio
@pytest.mark.parametrize("phase", ["validation", "authorization"])
async def test_expired_deadline_before_persistence_is_rejected(monkeypatch, phase):
    from app.services.insight_pack_adapter import InsightPack

    insight, repository = service()
    evidence = build_evidence(
        workspace(), insight._scope(workspace(), "initiative:1"), "owner", 2027
    )

    async def model(_):
        return valid_result(evidence), {}

    insight._call_model = model
    if phase == "validation":
        original = InsightPack.format_result_display

        def expire(pack, result):
            insight._deadline_at = 0
            return original(pack, result)

        monkeypatch.setattr(InsightPack, "format_result_display", expire)
    else:
        async def expire_user():
            insight._deadline_at = 0

        insight._refresh_user = expire_user
    with pytest.raises(HTTPException) as caught:
        await insight.generate(scope="initiative:1", planning_year=2027)
    assert caught.value.status_code == 504
    assert repository.records == []


@pytest.mark.asyncio
async def test_semantic_failure_gets_one_repair_before_persistence():
    insight, repository = service()
    evidence = build_evidence(
        workspace(), insight._scope(workspace(), "initiative:1"), "owner", 2027
    )
    calls = []

    async def model(body):
        calls.append(len(body["messages"]))
        candidate = valid_result(evidence)
        if len(calls) == 1:
            candidate["checks"][0]["summary"] = "建议核对低效投入。"
        return candidate, {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}

    insight._call_model = model
    record = await insight.generate(scope="initiative:1", planning_year=2027)
    assert calls == [2, 4]
    assert len(repository.records) == 1
    assert record["metadata"]["usage"]["total_tokens"] == 30
    assert [a["validation"] for a in record["metadata"]["attempts"]] == ["rejected", "passed"]


@pytest.mark.asyncio
async def test_second_inconsistent_response_is_not_saved():
    insight, repository = service()
    evidence = build_evidence(
        workspace(), insight._scope(workspace(), "initiative:1"), "owner", 2027
    )
    calls = 0

    async def model(_):
        nonlocal calls
        calls += 1
        candidate = valid_result(evidence)
        candidate["checks"][0]["summary"] = "建议核对低效投入。"
        return candidate, {}

    insight._call_model = model
    with pytest.raises(HTTPException) as error:
        await insight.generate(scope="initiative:1", planning_year=2027)
    assert error.value.status_code == 502
    assert calls == 2
    assert repository.records == []


@pytest.mark.asyncio
async def test_deadline_cancels_remote_wait_and_keeps_old_records():
    insight, repository = service()
    insight.settings.insight_timeout_seconds = 0.05
    cancelled = asyncio.Event()

    async def model(_):
        try:
            await asyncio.sleep(5)
        finally:
            cancelled.set()

    insight._call_model = model
    with pytest.raises(HTTPException) as error:
        await insight.generate(scope="initiative:1", planning_year=2027)
    assert error.value.status_code == 504
    assert cancelled.is_set()
    assert repository.records == []


@pytest.mark.asyncio
async def test_deadline_is_shared_with_repair():
    insight, repository = service()
    # Allow evidence/schema preparation to finish even on a loaded CI worker.
    # The repair then waits indefinitely and must be cancelled by the same deadline.
    insight.settings.insight_timeout_seconds = 2
    evidence = build_evidence(
        workspace(), insight._scope(workspace(), "initiative:1"), "owner", 2027
    )
    calls = []
    deadlines = []
    repair_cancelled = asyncio.Event()

    async def model(_):
        calls.append(1)
        deadlines.append(insight._deadline_at)
        if len(calls) == 2:
            try:
                await asyncio.Event().wait()
            finally:
                repair_cancelled.set()
        candidate = valid_result(evidence)
        candidate["checks"][0]["summary"] = "建议核对低效投入。"
        return candidate, {}

    insight._call_model = model
    with pytest.raises(HTTPException) as exc:
        await insight.generate(scope="initiative:1", planning_year=2027)
    assert exc.value.status_code == 504
    assert len(calls) == 2
    assert deadlines[0] == deadlines[1]
    assert repair_cancelled.is_set()
    assert repository.records == []


@pytest.mark.asyncio
@pytest.mark.parametrize("finish", ["stop", "length", None])
async def test_real_sse_protocol_usage_and_incomplete_stream(monkeypatch, finish):
    import json
    from types import SimpleNamespace

    import httpx

    insight, _ = service()
    insight.settings.ai_api_key = SimpleNamespace(get_secret_value=lambda: "test-key")
    insight.settings.ai_base_url = "https://example.test/v1"
    chunks = [
        {
            "id": "test-request",
            "choices": [{"delta": {"content": '{"ok":'}, "finish_reason": None}],
        },
        {"choices": [{"delta": {"content": "true}"}, "finish_reason": finish}]},
        {"choices": [], "usage": {"prompt_tokens": 12, "completion_tokens": 3, "total_tokens": 15}},
    ]
    stream = "".join("data: " + json.dumps(c) + "\n\n" for c in chunks) + "data: [DONE]\n\n"
    transport = httpx.MockTransport(
        lambda req: httpx.Response(200, text=stream, headers={"content-type": "text/event-stream"})
    )
    original = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: original(transport=transport, **kw))
    if finish != "stop":
        with pytest.raises(HTTPException):
            await insight._call_model({})
    else:
        data, usage = await insight._call_model({})
        assert data == {"ok": True}
        assert usage["total_tokens"] == 15
        assert usage["request_id"] == "test-request"
        assert usage["first_token_seconds"] is not None
