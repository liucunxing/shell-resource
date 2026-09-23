import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.do.insight import InsightPromptDO, InsightRecordDO
from app.repositories.insight_repository import InsightRepository
from app.services.insight_service import InsightService


class FakeSession:
    def __init__(self) -> None:
        self._active = False
        self.rollback_calls = 0

    def in_transaction(self) -> bool:
        return self._active

    async def rollback(self) -> None:
        self.rollback_calls += 1
        self._active = False

    async def commit(self) -> None:
        self._active = False

    def begin(self):
        session = self

        class Transaction:
            async def __aenter__(self):
                session._active = True

            async def __aexit__(self, *_):
                session._active = False

        return Transaction()


class FakeRepository:
    def __init__(self) -> None:
        self.prompt = None
        self.records = []

    async def get_prompt(self, *_):
        return self.prompt

    async def get_prompt_for_update(self, *_):
        return self.prompt

    async def latest_record(self, *_):
        return self.records[-1] if self.records else None

    async def add_record(self, record):
        self.records.append(record)
        return record

    async def add_prompt(self, prompt):
        self.prompt = prompt
        return prompt


def workspace() -> dict:
    return {
        "state": {
            "initiatives": [
                {
                    "id": "1",
                    "ownerId": "owner@example.com",
                    "department": "MKT",
                    "budget": 100,
                    "revision": 2,
                    "rows": [{"dealerId": "D1", "amount": 80}],
                    "otherBudgets": [{"reasonId": "reserve", "amount": 20}],
                }
            ],
            "reference": {"batchId": "REF-1"},
            "guide": {"version": 3, "text": "guide"},
            "budgetReasonVersion": 4,
        },
        "data": {"dealers": []},
        "identity": {},
        "users": [],
    }


def service(role="owner"):
    repository = FakeRepository()
    result = InsightService(
        session=FakeSession(),
        user=SimpleNamespace(email="owner@example.com", role=role, department="MKT", sector="PCMO"),
        settings=SimpleNamespace(
            ai_api_key=None, ai_base_url="", ai_model="qwen-plus", ai_timeout_seconds=1
        ),
        repository=repository,
    )

    async def get_workspace(_):
        return workspace()

    result._workspace = get_workspace
    return result, repository


def test_owner_scope_is_limited_to_current_email() -> None:
    insight, _ = service()
    result = asyncio.run(insight.get_insight(scope="owner:owner@example.com", planning_year=2027))
    assert result["record"] is None
    assert result["prompt"]["editable"] is True
    with pytest.raises(HTTPException, match="只能查看本人"):
        asyncio.run(insight.get_insight(scope="owner:other@example.com", planning_year=2027))


def test_management_cannot_generate() -> None:
    insight, _ = service(role="management")
    with pytest.raises(HTTPException) as error:
        asyncio.run(insight.generate(scope="global", planning_year=2027))
    assert error.value.status_code == 403


def test_management_reads_snapshot_preview_without_calling_model() -> None:
    insight, repository = service(role="management")
    result = asyncio.run(insight.get_insight(scope="global", planning_year=2027))
    assert result["record"]["status"] == "preview"
    assert len(result["record"]["items"]) == 6
    assert result["prompt"]["editable"] is False
    assert repository.records == []


def test_old_analysis_is_hidden_after_permission_scope_changes() -> None:
    insight, repository = service(role="lead")
    descriptor = insight._scope(workspace(), "MKT")
    repository.records.append(SimpleNamespace(record={"access": insight._access(descriptor)}))
    insight.user.sector = "another-sector"
    result = asyncio.run(insight.get_insight(scope="MKT", planning_year=2027))
    assert result["record"] is None


def test_model_failure_does_not_write_a_record() -> None:
    insight, repository = service()
    with pytest.raises(HTTPException, match="尚未配置"):
        asyncio.run(insight.generate(scope="initiative:1", planning_year=2027))
    assert repository.records == []


def test_non_json_model_response_preserves_existing_record(monkeypatch) -> None:
    insight, repository = service()
    insight.settings.ai_api_key = SimpleNamespace(get_secret_value=lambda: "key")
    insight.settings.ai_base_url = "https://example.test/v1"
    repository.records.append(SimpleNamespace(record={"id": "old"}))

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {"choices": [{"message": {"content": "not json"}}]}

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return None

        async def post(self, *_args, **_kwargs):
            return Response()

    monkeypatch.setattr(httpx, "AsyncClient", lambda **_kwargs: Client())
    with pytest.raises(HTTPException, match="生成失败"):
        asyncio.run(insight.generate(scope="initiative:1", planning_year=2027))
    assert len(repository.records) == 1
    assert repository.records[0].record["id"] == "old"


def test_evidence_is_six_points_and_balance_is_server_calculated() -> None:
    insight, _ = service()
    result, _ = insight._evidence(workspace(), insight._scope(workspace(), "initiative:1"))
    assert [item["key"] for item in result] == [
        "low_yield",
        "high_yield",
        "concentration",
        "overlap",
        "trend",
        "completeness",
    ]
    assert result[-1]["facts"]["未解释差额"] == 0.0


def test_success_uses_authorized_yield_and_marks_changed_basis_stale(monkeypatch) -> None:
    async def run() -> None:
        insight, repository = service()
        insight.settings.ai_api_key = SimpleNamespace(get_secret_value=lambda: "key")
        insight.settings.ai_base_url = "https://example.test/v1"
        initial = workspace()
        initial["data"]["dealers"] = [
            {
                "id": "D1",
                "history": {
                    "yield2025": 1.25,
                    "resources2025": {"hidden": 999},
                    "vol2024": 10,
                    "vol2025": 12,
                    "c32024": 2,
                    "c32025": 3,
                },
            }
        ]
        changed = workspace()
        changed["state"]["initiatives"][0]["revision"] = 3
        calls = 0

        async def get_workspace(_):
            nonlocal calls
            calls += 1
            return initial if calls == 1 else changed

        insight._workspace = get_workspace
        reviews = [
            {"key": key, "review": "请结合已给事实复核。"}
            for key in (
                "low_yield",
                "high_yield",
                "concentration",
                "overlap",
                "trend",
                "completeness",
            )
        ]
        captured = {}

        def handler(request):
            captured.update(json.loads(request.content))
            return httpx.Response(
                200,
                json={"choices": [{"message": {"content": json.dumps({"items": reviews})}}]},
            )

        original_client = httpx.AsyncClient
        monkeypatch.setattr(
            httpx,
            "AsyncClient",
            lambda **kwargs: original_client(transport=httpx.MockTransport(handler), **kwargs),
        )
        record = await insight.generate(scope="initiative:1", planning_year=2027)
        assert record["stale"] is True
        assert len(repository.records) == 1
        request_text = captured["messages"][1]["content"]
        assert "resources2025" not in request_text
        assert "整体资源" not in request_text
        assert record["items"][0]["status"] == "review"

    asyncio.run(run())


def test_duplicate_or_timeout_model_response_preserves_old_record(monkeypatch) -> None:
    async def run() -> None:
        insight, repository = service()
        insight.settings.ai_api_key = SimpleNamespace(get_secret_value=lambda: "key")
        insight.settings.ai_base_url = "https://example.test/v1"
        repository.records.append(SimpleNamespace(record={"id": "old"}))

        duplicate = [{"key": "low_yield", "review": "重复。"}] * 6

        def duplicate_handler(_):
            return httpx.Response(
                200,
                json={"choices": [{"message": {"content": json.dumps({"items": duplicate})}}]},
            )

        original_client = httpx.AsyncClient
        monkeypatch.setattr(
            httpx,
            "AsyncClient",
            lambda **kwargs: original_client(
                transport=httpx.MockTransport(duplicate_handler), **kwargs
            ),
        )
        with pytest.raises(HTTPException) as error:
            await insight.generate(scope="initiative:1", planning_year=2027)
        assert error.value.status_code == 502
        assert [row.record["id"] for row in repository.records] == ["old"]

        def timeout_handler(_):
            raise httpx.ReadTimeout("timeout")

        monkeypatch.setattr(
            httpx,
            "AsyncClient",
            lambda **kwargs: original_client(
                transport=httpx.MockTransport(timeout_handler), **kwargs
            ),
        )
        with pytest.raises(HTTPException) as timeout_error:
            await insight.generate(scope="initiative:1", planning_year=2027)
        assert timeout_error.value.status_code == 502
        assert [row.record["id"] for row in repository.records] == ["old"]

    asyncio.run(run())


def test_prompt_update_uses_a_real_sqlalchemy_transaction() -> None:
    async def run() -> None:
        engine = create_async_engine("sqlite+aiosqlite://")
        async with engine.begin() as connection:
            await connection.execute(text("ATTACH DATABASE ':memory:' AS data"))
            await connection.run_sync(InsightPromptDO.__table__.create)
        factory = async_sessionmaker(engine, expire_on_commit=False)
        async with factory() as session:
            repository = InsightRepository(session)
            async with session.begin():
                await repository.add_prompt(
                    InsightPromptDO(
                        id=1, planning_year=2027, scope="initiative:1", text="old", version=1
                    )
                )
            insight = InsightService(
                session=session,
                user=SimpleNamespace(email="owner@example.com", role="owner", department="MKT"),
                settings=SimpleNamespace(),
                repository=repository,
            )

            async def get_workspace(_):
                return workspace()

            insight._workspace = get_workspace
            updated = await insight.update_prompt(
                scope="initiative:1", planning_year=2027, text="new", expected_version=1
            )
            assert updated["version"] == 2
            assert (await repository.get_prompt(2027, "initiative:1")).text == "new"
        await engine.dispose()

    asyncio.run(run())


@pytest.mark.asyncio
async def test_latest_analysis_keeps_each_department_leads_record() -> None:
    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.begin() as connection:
        await connection.execute(text("ATTACH DATABASE ':memory:' AS data"))
        await connection.run_sync(InsightRecordDO.__table__.create)
        await connection.run_sync(InsightPromptDO.__table__.create)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        repository = InsightRepository(session)
        insight = InsightService(
            session=session,
            user=SimpleNamespace(email="a@example.com", role="lead", department="MKT", sector=None),
            settings=SimpleNamespace(),
            repository=repository,
        )

        async def get_workspace(_):
            return workspace()

        insight._workspace = get_workspace
        access = insight._access(insight._scope(workspace(), "MKT"))
        for email, record in [
            ("a@example.com", {"id": "a-record", "access": access}),
            ("b@example.com", {"id": "b-record", "access": {**access, "email": "b@example.com"}}),
        ]:
            await repository.add_record(
                InsightRecordDO(
                    planning_year=2027,
                    scope="MKT",
                    signature="old",
                    prompt_version=0,
                    guide_version=0,
                    created_by_email=email,
                    record=record,
                )
            )
        await session.commit()
        assert (await repository.latest_record(2027, "MKT")).created_by_email == "b@example.com"
        result = await insight.get_insight(scope="MKT", planning_year=2027)
        assert result["record"]["id"] == "a-record"
    await engine.dispose()
