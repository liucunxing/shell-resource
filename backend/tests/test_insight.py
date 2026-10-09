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
        user=SimpleNamespace(email="owner@example.com", role=role, department="MKT"),
        settings=SimpleNamespace(
            ai_api_key=None, ai_base_url="", ai_model="qwen-plus", ai_timeout_seconds=1
        ),
        repository=repository,
    )

    async def get_workspace(_):
        return workspace()

    result._workspace = get_workspace

    async def refresh_user():
        return None

    result._refresh_user = refresh_user
    return result, repository


def test_owner_scope_is_limited_to_current_email() -> None:
    insight, _ = service()
    result = asyncio.run(insight.get_insight(scope="owner:owner@example.com", planning_year=2027))
    assert result["record"] is None
    assert result["prompt"]["editable"] is False
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
    insight.user.email = "another-lead@example.com"
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
                    "yield": 1.25,
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
        captured = {}

        def handler(request):
            captured.update(json.loads(request.content))
            return httpx.Response(
                200,
                json={
                    "choices": [
                        {
                            "message": {
                                "content": json.dumps(
                                    valid_result(
                                        json.loads(captured["messages"][1]["content"])["evidence"]
                                    )
                                )
                            }
                        }
                    ]
                },
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
        assert record["result"]["checks"][0]["status"] == "observed"
        assert record["evidence"]["facts"]
        assert captured["enable_thinking"] is False

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
            with pytest.raises(HTTPException) as error:
                await insight.update_prompt(
                    scope="initiative:1", planning_year=2027, text="new", expected_version=1
                )
            assert error.value.status_code == 403
            assert (await repository.get_prompt(2027, "initiative:1")).text == "old"
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
            user=SimpleNamespace(email="a@example.com", role="lead", department="MKT"),
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


def valid_result(evidence, preset="comprehensive"):
    checks = [
        dict(
            dimension_id=c["dimension_id"],
            status=c["allowed_statuses"][0],
            summary="Authorized fact.",
            fact_ids=["budget"],
        )
        for c in evidence["check_constraints"]
    ]
    blocks = (
        [
            dict(
                id="gap",
                kind="finding",
                title="Budget gap",
                body="Review gap.",
                status="review",
                dimension_ids=["completeness"],
                fact_ids=["gap"],
                dataset_id=None,
            )
        ]
        if any(c.get("required_focus") for c in evidence["check_constraints"])
        else []
    )
    return dict(
        schema_version="1.0",
        preset_id=preset,
        headline="Analysis",
        summary="Authorized facts.",
        blocks=blocks,
        checks=checks,
        limitations=[],
    )


def test_full_cohort_distinct_overlap_and_missing_history():
    from app.services.insight_pack_adapter import PACK_ROOT, InsightPack, build_evidence

    data = workspace()
    item = data["state"]["initiatives"][0]
    item["rows"] = [dict(dealerId=f"D{i}", amount=i * 10) for i in range(1, 7)] + [
        dict(dealerId="D1", amount=1)
    ]
    data["data"]["dealers"] = [
        dict(id=f"D{i}", history=dict(yield_value=i, **{"yield": i})) for i in range(1, 6)
    ]
    insight, _ = service()
    evidence = build_evidence(data, insight._scope(data, "initiative:1"), "owner", 2027)
    facts = {f["id"]: f for f in evidence["facts"]}
    datasets = {d["id"]: d for d in evidence["datasets"]}
    assert facts["overlap"]["value"] == 0
    assert datasets["yield-plan"]["population_count"] == 6
    assert datasets["yield-plan"]["excluded_count"] == 1
    assert datasets["yield-plan"]["x"]["cutoff"] == 3
    assert len(datasets["yield-table"]["rows"]) == 6
    assert datasets["yield-table"]["rows"][-1]["yield_value"] is None
    assert facts["business-guide"]["value"] == "guide"
    assert "3" in facts["business-guide"]["note"]
    pack = InsightPack(PACK_ROOT)
    body, _ = pack.compile(evidence)
    assert "uniqueItems" not in json.dumps(body["response_format"])
    bad = valid_result(evidence)
    bad["checks"][0]["fact_ids"] = ["budget", "budget"]
    with pytest.raises(ValueError):
        pack.validate_result(bad, evidence)


def test_permission_changes_during_generation_do_not_persist():
    async def run():
        from app.services.insight_pack_adapter import build_evidence

        insight, repository = service()
        data = workspace()

        async def model(_):
            evidence = build_evidence(data, insight._scope(data, "initiative:1"), "owner", 2027)
            insight.user.role = "management"
            return valid_result(evidence), {}

        insight._call_model = model
        with pytest.raises(HTTPException) as error:
            await insight.generate(scope="initiative:1", planning_year=2027)
        assert error.value.status_code == 403
        assert repository.records == []

    asyncio.run(run())


@pytest.mark.asyncio
async def test_repository_preset_filter_isolates_saved_results():
    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.begin() as connection:
        await connection.execute(text("ATTACH DATABASE ':memory:' AS data"))
        await connection.run_sync(InsightRecordDO.__table__.create)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        repo = InsightRepository(session)
        for i, preset in enumerate([None, "quadrant", "structure"]):
            record = {} if preset is None else {"presetId": preset}
            await repo.add_record(
                InsightRecordDO(
                    id=i + 1,
                    planning_year=2027,
                    scope="MKT",
                    signature="x",
                    prompt_version=0,
                    guide_version=0,
                    created_by_email="a",
                    record=record,
                )
            )
        await session.commit()
        for preset, expected in [("comprehensive", 1), ("quadrant", 2), ("structure", 3)]:
            assert (await repo.latest_record(2027, "MKT", "a", preset)).id == expected
    await engine.dispose()


def test_request_schema_binds_authorized_references_and_states():
    from jsonschema import Draft202012Validator

    from app.services.insight_pack_adapter import PACK_ROOT, InsightPack, build_evidence

    insight, _ = service()
    data = workspace()
    evidence = build_evidence(data, insight._scope(data, "initiative:1"), "owner", 2027)
    body, _ = InsightPack(PACK_ROOT).compile(evidence)
    schema = body["response_format"]["json_schema"]["schema"]
    validator = Draft202012Validator(schema)
    valid = valid_result(evidence)
    validator.validate(valid)
    valid["checks"][0]["status"] = "review"
    assert list(validator.iter_errors(valid))
    valid = valid_result(evidence)
    valid["checks"][0]["fact_ids"] = ["fabricated"]
    assert list(validator.iter_errors(valid))
    valid = valid_result(evidence)
    valid["blocks"] = [
        dict(
            id="x",
            kind="visual",
            title="x",
            body="x",
            status="observed",
            dimension_ids=["concentration"],
            fact_ids=["budget"],
            dataset_id="not-authorized",
        )
    ]
    assert list(validator.iter_errors(valid))


@pytest.mark.parametrize("change", ["disabled", "role", "sector"])
def test_refreshed_permissions_reject_changed_access(change):
    async def run():
        from app.services.insight_pack_adapter import build_evidence

        insight, repository = service()
        data = workspace()

        async def model(_):
            return valid_result(
                build_evidence(data, insight._scope(data, "initiative:1"), "owner", 2027)
            ), {}

        async def refresh():
            if change == "disabled":
                raise HTTPException(status_code=403, detail="permission disabled")
            if change == "role":
                insight.user.role = "management"
            if change == "sector":
                insight.user.sectors = ("new-sector",)

        insight._call_model = model
        insight._refresh_user = refresh
        with pytest.raises(HTTPException) as error:
            await insight.generate(scope="initiative:1", planning_year=2027)
        assert error.value.status_code in {403, 409}
        assert not repository.records

    asyncio.run(run())


def test_normalization_only_removes_duplicate_set_members():
    from copy import deepcopy

    from app.services.insight_pack_adapter import normalize_result

    candidate = dict(
        checks=[dict(dimension_id="trend", fact_ids=["x", "x"], status="review") for _ in range(2)],
        blocks=[
            dict(
                id="same",
                dimension_ids=["trend", "trend"],
                fact_ids=["x", "y", "x"],
                body="12 is unchanged",
                value=12,
            )
        ],
    )
    original = deepcopy(candidate)
    result, changes = normalize_result(candidate)
    assert candidate == original
    assert len(result["checks"]) == 2
    assert result["checks"][0]["status"] == "review"
    assert result["blocks"][0]["dimension_ids"] == ["trend"]
    assert result["blocks"][0]["fact_ids"] == ["x", "y"]
    assert result["blocks"][0]["body"] == "12 is unchanged"
    assert result["blocks"][0]["value"] == 12
    assert len(changes) == 4


def test_available_history_is_observed_without_future_targets():
    from app.services.insight_pack_adapter import build_evidence

    insight, _ = service()
    data = workspace()
    data["data"]["dealers"] = [dict(id="D1", history={"yield": 1.5, "vol2024": 10, "vol2025": 11})]
    evidence = build_evidence(data, insight._scope(data, "initiative:1"), "owner", 2027)
    constraints = {row["dimension_id"]: row for row in evidence["check_constraints"]}
    for dimension in ["low_yield", "high_yield", "trend"]:
        assert constraints[dimension]["allowed_statuses"] == ["observed"]
    data["data"]["dealers"][0]["history"] = {"vol2025": 11}
    evidence = build_evidence(data, insight._scope(data, "initiative:1"), "owner", 2027)
    constraints = {row["dimension_id"]: row for row in evidence["check_constraints"]}
    for dimension in ["low_yield", "high_yield", "trend"]:
        assert constraints[dimension]["allowed_statuses"] == ["limited"]
    assert constraints["concentration"]["allowed_statuses"] == ["observed"]


def test_chart_requires_shared_fact_reference():
    from app.services.insight_pack_adapter import PACK_ROOT, InsightPack, build_evidence

    insight, _ = service()
    data = workspace()
    evidence = build_evidence(data, insight._scope(data, "initiative:1"), "owner", 2027)
    result = valid_result(evidence)
    result["blocks"] = [
        dict(
            id="mismatch",
            kind="visual",
            title="x",
            body="x",
            status="observed",
            dimension_ids=["concentration"],
            fact_ids=["cohort"],
            dataset_id="budget-mix",
        )
    ]
    with pytest.raises(ValueError, match="共享"):
        InsightPack(PACK_ROOT).validate_result(result, evidence)


def test_api_visual_schema_binds_dataset_title_and_facts():
    from copy import deepcopy

    from jsonschema import Draft202012Validator

    from app.services.insight_pack_adapter import PACK_ROOT, InsightPack, build_evidence

    insight, _ = service()
    data = workspace()
    evidence = build_evidence(data, insight._scope(data, "initiative:1"), "owner", 2027)
    body, _ = InsightPack(PACK_ROOT).compile(evidence)
    validator = Draft202012Validator(body["response_format"]["json_schema"]["schema"])
    dataset = next(row for row in evidence["datasets"] if row["id"] == "budget-mix")
    candidate = valid_result(evidence)
    candidate["blocks"] = [
        dict(
            id="budget-view",
            kind="visual",
            title=dataset["title"],
            body="Budget allocation.",
            status="observed",
            dimension_ids=["completeness"],
            fact_ids=[dataset["fact_ids"][0]],
            dataset_id=dataset["id"],
        )
    ]
    validator.validate(candidate)
    for field, value in [
        ("title", "Unrelated yield title"),
        ("fact_ids", ["cohort"]),
        ("fact_ids", []),
        ("kind", "finding"),
    ]:
        invalid = deepcopy(candidate)
        invalid["blocks"][0][field] = value
        assert list(validator.iter_errors(invalid)), field
    candidate["blocks"][0].update(
        kind="finding", dataset_id=None, title="Custom finding", fact_ids=["cohort"]
    )
    validator.validate(candidate)
