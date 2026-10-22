import json
from types import SimpleNamespace

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI, HTTPException
from sqlalchemy import func, select, update

from app.controllers.insight_controller import router
from app.core.config import get_settings
from app.db.session import get_db_session
from app.dependencies.workbench_user import WorkbenchUser
from app.models.do.budget import BudgetDO
from app.models.do.distributor_history import distributor_sellin_resource_history
from app.models.do.insight import InsightPromptDO, InsightRecordDO
from app.models.do.workspace import UserPermissionDO
from app.schemas.dto.workbench import InitiativeDraftUpdateDTO, PublishDTO
from app.services.insight_pack_adapter import _module
from app.services.insight_preview_service import InsightPreviewService
from app.services.insight_service import InsightService
from test_insight import valid_result
from test_workspace import _session, _workspace_service

ADMIN = WorkbenchUser("admin@example.com", "admin", [], "Admin")
SETTINGS = SimpleNamespace(ai_model="test")


@pytest_asyncio.fixture
async def preview_session():
    session = await _session()
    await session.execute(
        update(UserPermissionDO).where(UserPermissionDO.id == 1).values(department=["ICE"])
    )
    await session.execute(
        update(BudgetDO)
        .where(BudgetDO.id == 1)
        .values(department="ICE", sector="PCMO", resource_type="MRD")
    )
    for index, (email, role, enabled) in enumerate(
        [
            (ADMIN.email, "admin", True),
            ("lead@example.com", "lead", True),
            ("management@example.com", "management", True),
            ("disabled@example.com", "owner", False),
        ],
        2,
    ):
        session.add(
            UserPermissionDO(
                id=index,
                email=email,
                display_name=role,
                role=role,
                department=["ICE"],
                sector=["PCMO"],
                enabled=enabled,
            )
        )
    session.add(InsightPromptDO(planning_year=2027, scope="global", text="全局试用规则", version=3))
    session.add(
        InsightPromptDO(
            planning_year=2027, scope="owner:a@example.com", text="不能使用的旧个人规则", version=8
        )
    )
    await session.execute(
        distributor_sellin_resource_history.update().values(
            yield_2025=5.6, mrd_2025=12345, volume_2024=100, volume_2025=110
        )
    )
    await session.commit()
    owner = WorkbenchUser("a@example.com", "owner", ["ICE"], "A", ("PCMO",))
    work = _workspace_service(session, owner)
    await work.save_draft(
        1, InitiativeDraftUpdateDTO(expected_revision=0, rows=[{"dealerId": "d1", "amount": 100}])
    )
    await work.publish(1, PublishDTO(expected_revision=1))
    await work.save_draft(
        1,
        InitiativeDraftUpdateDTO(
            expected_revision=1,
            rows=[{"dealerId": "d1", "amount": 50}],
            otherBudgets=[{"reasonId": "misc", "amount": 50, "note": "reserve"}],
        ),
    )
    yield session
    engine = session.bind
    await session.close()
    await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "email,role,scope,amount",
    [
        ("a@example.com", "owner", "owner:a@example.com", 50),
        ("lead@example.com", "lead", "ICE", 50),
        ("management@example.com", "management", "global", 100),
    ],
)
async def test_preview_uses_target_scope_and_global_prompt_without_saving(
    preview_session, monkeypatch, email, role, scope, amount
):
    service = await InsightPreviewService.create(preview_session, ADMIN, email, SETTINGS)
    context = await service.context(2027)
    assert context["identity"]["role"] == role
    assert context["scopes"][0]["id"] == scope
    assert "initiative:2" not in json.dumps(context)
    captured = {}

    async def model(body):
        captured.update(body)
        evidence = _module._consistency.expand_evidence(
            json.loads(body["messages"][1]["content"])["evidence"]
        )
        return valid_result(evidence), {}

    service._call_model = model
    record = await service.generate(scope=scope, planning_year=2027)
    facts = {f["id"]: f["value"] for f in record["evidence"]["facts"]}
    assert facts["allocated"] == amount
    assert facts["yield:d1"] == 5.6
    if role != "management":
        assert not any(key.startswith("investment") for key in facts)
        assert "12345" not in json.dumps(captured)
    assert "全局试用规则" in json.dumps(captured, ensure_ascii=False)
    assert "不能使用的旧个人规则" not in json.dumps(captured, ensure_ascii=False)
    assert record["promptVersion"] == 3 and record["promptScope"] == "global"
    assert record["simulation"]["persisted"] is False
    assert await preview_session.scalar(select(func.count()).select_from(InsightRecordDO)) == 0


@pytest.mark.asyncio
async def test_preview_rejects_non_admin_disabled_target_and_foreign_scope(preview_session):
    owner = WorkbenchUser("a@example.com", "owner", ["ICE"], "A")
    with pytest.raises(HTTPException) as blocked:
        await InsightPreviewService.create(preview_session, owner, ADMIN.email, SETTINGS)
    assert blocked.value.status_code == 403
    for email in ["disabled@example.com", "unknown@example.com"]:
        with pytest.raises(HTTPException) as blocked:
            await InsightPreviewService.create(preview_session, ADMIN, email, SETTINGS)
        assert blocked.value.status_code == 403
    service = await InsightPreviewService.create(preview_session, ADMIN, owner.email, SETTINGS)
    with pytest.raises(HTTPException) as blocked:
        await service.generate(scope="initiative:2", planning_year=2027)
    assert blocked.value.status_code == 404


@pytest.mark.asyncio
@pytest.mark.parametrize("revoke", [ADMIN.email, "a@example.com"])
async def test_revocation_during_generation_discards_preview(preview_session, revoke):
    service = await InsightPreviewService.create(preview_session, ADMIN, "a@example.com", SETTINGS)

    async def model(body):
        evidence = _module._consistency.expand_evidence(
            json.loads(body["messages"][1]["content"])["evidence"]
        )
        await preview_session.execute(
            update(UserPermissionDO).where(UserPermissionDO.email == revoke).values(enabled=False)
        )
        await preview_session.commit()
        return valid_result(evidence), {}

    service._call_model = model
    with pytest.raises(HTTPException) as blocked:
        await service.generate(scope="owner:a@example.com", planning_year=2027)
    assert blocked.value.status_code == 403
    assert await preview_session.scalar(select(func.count()).select_from(InsightRecordDO)) == 0


@pytest.mark.asyncio
async def test_preview_http_routes_require_real_admin_header(preview_session, monkeypatch):
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_db_session] = lambda: preview_session
    app.dependency_overrides[get_settings] = lambda: SETTINGS

    async def model(self, body):
        evidence = _module._consistency.expand_evidence(
            json.loads(body["messages"][1]["content"])["evidence"]
        )
        return valid_result(evidence), {}

    monkeypatch.setattr(InsightService, "_call_model", model)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        params = {"user_email": "a@example.com", "planning_year": 2027}
        response = await client.get(
            "/insights/preview", params=params, headers={"X-User-Email": "a@example.com"}
        )
        assert response.status_code == 403
        response = await client.get(
            "/insights/preview", params=params, headers={"X-User-Email": ADMIN.email}
        )
        assert response.status_code == 200
        response = await client.post(
            "/insights/preview",
            json={**params, "scope": "initiative:1"},
            headers={"X-User-Email": ADMIN.email},
        )
        assert response.status_code == 200
        assert response.json()["data"]["simulation"]["email"] == "a@example.com"
