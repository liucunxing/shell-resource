import asyncio
import logging
import re

import httpx
import pytest
from fastapi import FastAPI, HTTPException

from app.core.exception_handlers import register_exception_handlers
from test_insight import service


@pytest.mark.asyncio
async def test_overview_repair_targets_summary_and_logs_validation_phase(caplog):
    import copy

    from app.services.insight_pack_adapter import build_evidence
    from test_insight import valid_result, workspace

    insight, repository = service()
    data = workspace()
    evidence = build_evidence(data, insight._scope(data, "initiative:1"), "owner", 2027)
    valid = valid_result(evidence)
    calls = 0

    async def model(body):
        nonlocal calls
        calls += 1
        candidate = copy.deepcopy(valid)
        if calls == 1:
            candidate["summary"] = "本次计划987654321万元。"
        else:
            instruction = body["messages"][-1]["content"]
            assert "overview指顶层headline和summary" in instruction
            assert "必须重写顶层summary" in instruction
            assert "overview:unbound_number" in instruction
        return candidate, {}

    insight._call_model = model
    with caplog.at_level(logging.INFO):
        record = await insight.generate(scope="initiative:1", planning_year=2027)
    assert calls == 2 and len(repository.records) == 1
    assert record["metadata"]["attempts"][0]["validation_phase"] == "raw_facts"
    assert "phase=raw_facts" in caplog.text
    assert "insight.request_compiled" in caplog.text
    assert "987654321" not in caplog.text


@pytest.mark.asyncio
async def test_concurrent_failures_have_distinct_safe_ids_and_response_headers(caplog):
    app = FastAPI()
    register_exception_handlers(app)

    @app.get("/generate")
    async def generate():
        insight, _ = service()

        async def fail(**kwargs):
            await asyncio.sleep(0)
            raise HTTPException(502, "生成失败")

        insight._generate = fail
        return await insight.generate(scope="owner:owner@example.com", planning_year=2027)

    with caplog.at_level(logging.INFO):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            responses = await asyncio.gather(client.get("/generate"), client.get("/generate"))
    ids = [r.headers["X-Insight-Request-ID"] for r in responses]
    assert len(set(ids)) == 2
    assert all(re.fullmatch("[a-f0-9]{32}", value) for value in ids)
    assert all(caplog.text.count(value) == 2 for value in ids)
    assert "owner@example.com" not in caplog.text
    assert "scope_hash" in caplog.text and "user_hash" in caplog.text


@pytest.mark.asyncio
async def test_timeout_preserves_safe_partial_diagnostics(caplog):
    insight, _ = service()
    insight.settings.insight_timeout_seconds = 0.01

    async def wait(**kwargs):
        insight._stage = "model"
        insight._model_diagnostics = {
            "request_id": "provider-123",
            "content_bytes": 24,
            "stage": "receive",
        }
        await asyncio.sleep(1)

    insight._generate = wait
    with caplog.at_level(logging.WARNING), pytest.raises(HTTPException) as caught:
        await insight.generate(scope="private-scope", planning_year=2027)
    assert caught.value.status_code == 504
    assert caught.value.headers["X-Insight-Request-ID"] in caplog.text
    assert "provider-123" in caplog.text and '"content_bytes": 24' in caplog.text
    assert "stage=model" in caplog.text
    assert "private-scope" not in caplog.text


@pytest.mark.asyncio
@pytest.mark.parametrize("database", [False, True])
async def test_unexpected_failures_are_handled_without_sensitive_asgi_reraise(caplog, database):
    from sqlalchemy.exc import SQLAlchemyError

    app = FastAPI()
    register_exception_handlers(app)

    @app.get("/generate")
    async def generate():
        insight, _ = service()

        async def fail(**kwargs):
            if database:
                raise SQLAlchemyError("PRIVATE_SQL_VALUE")
            raise RuntimeError("PRIVATE_PROVIDER_CONTENT")

        insight._generate = fail
        return await insight.generate(scope="owner:owner@example.com", planning_year=2027)

    # raise_app_exceptions=True tests the complete Starlette middleware stack.
    # ServerErrorMiddleware would otherwise re-raise even after emitting a 500.
    with caplog.at_level(logging.INFO):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, raise_app_exceptions=True),
            base_url="http://test",
        ) as client:
            response = await client.get("/generate")
    assert response.status_code == (503 if database else 500)
    assert re.fullmatch("[a-f0-9]{32}", response.headers["X-Insight-Request-ID"])
    assert response.headers["X-Insight-Request-ID"] in caplog.text
    assert response.json()["msg"] == (
        "数据库暂不可用，请检查连接与表结构后重试" if database else "Insight 生成失败，原记录已保留"
    )
    for secret in ("PRIVATE_SQL_VALUE", "PRIVATE_PROVIDER_CONTENT", "owner@example.com"):
        assert secret not in response.text and secret not in caplog.text
    assert not any(record.exc_info for record in caplog.records)
