"""Confirmed permission matrix: reads, writes, prompt versions and synced AI inputs."""

import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.dependencies.workbench_user import WorkbenchUser
from app.models.do.insight import InsightRecordDO
from app.models.do.workspace import WorkspaceConfigDO
from app.schemas.dto.workbench import AdminConfigDTO, InitiativeDraftUpdateDTO, PublishDTO
from app.services.admin_service import AdminService
from app.services.insight_pack_adapter import build_evidence
from app.services.insight_service import InsightService
from app.services.workspace_service import WorkspaceService
from test_insight import service as fake_insight_service
from test_insight import valid_result
from test_workspace import _owner, _session, _workspace_service


def user(role, department=()):
    return WorkbenchUser(f"{role}@example.com", role, department, role, ("PCMO",))


async def published_then_changed(session):
    owner = _workspace_service(session, _owner())
    await owner.save_draft(
        1,
        InitiativeDraftUpdateDTO(
            expected_revision=0,
            rows=[{"dealerId": "d1", "amount": 90, "note": "published"}],
            otherBudgets=[{"reasonId": "misc", "amount": 10, "note": "published other"}],
        ),
    )
    await owner.publish(1, PublishDTO(expected_revision=1))
    await owner.save_draft(
        1,
        InitiativeDraftUpdateDTO(
            expected_revision=1,
            rows=[{"dealerId": "d2", "amount": 100, "note": "draft secret"}],
        ),
    )


@pytest.mark.asyncio
async def test_admin_reads_drafts_versions_and_all_logs_but_cannot_write():
    session = await _session()
    try:
        await published_then_changed(session)
        admin = WorkspaceService(session, user("admin"))
        workspace = await admin.get_workspace(2027)
        assert workspace["state"]["dataBasis"] == "draft"
        assert workspace["state"]["initiatives"][0]["rows"][0]["note"] == "draft secret"
        assert {log["operation"] for log in workspace["state"]["audit"]} >= {
            "DRAFT_SAVE",
            "PUBLISH",
        }
        assert (await admin.publications(1))[0]["initiative"]["rows"][0]["amount"] == 90
        assert (await admin.get_draft(1))["revision"] == 2
        for operation in [
            admin.save_draft(1, InitiativeDraftUpdateDTO(expected_revision=2)),
            admin.publish(1, PublishDTO(expected_revision=2)),
        ]:
            with pytest.raises(HTTPException) as error:
                await operation
            assert error.value.status_code == 403
    finally:
        await session.close()
        await session.bind.dispose()


@pytest.mark.asyncio
async def test_configured_resource_union_is_enforced_for_owner_and_lead_without_total():
    session = await _session()
    try:
        admin = AdminService(session, user("admin"))
        result = await admin.update_config(
            AdminConfigDTO(
                expected_revision=0,
                departmentResources={"MKT": ["MRD"], "ICE": ["SP&A"], "NEW": ["Capex"]},
            )
        )
        assert result["departmentResources"]["ICE"] == ["SP&A"]
        for role in ("owner", "lead"):
            ws = await WorkspaceService(session, user(role, ("MKT", "ICE"))).get_workspace(2027)
            assert {row["id"] for row in ws["data"]["dealers"]} == {"d1", "d2", "d3"}
            for row in ws["data"]["dealers"]:
                assert set(row["history"]["resources2025"]) == {"MRD", "SP&A"}
                assert "yield" in row["history"]
                assert "resource_total" not in row["history"]
        # Empty scope never grants every column; custom departments work without code changes.
        for deps, resources in [((), set()), (("NEW",), {"Capex"})]:
            ws = await WorkspaceService(session, user("lead", deps)).get_workspace(2027)
            assert set(ws["data"]["dealers"][0]["history"]["resources2025"]) == resources
        with pytest.raises(HTTPException) as error:
            await AdminService(session, user("lead", ("MKT",))).update_config(
                AdminConfigDTO(expected_revision=1, departmentResources={})
            )
        assert error.value.status_code == 403
    finally:
        await session.close()
        await session.bind.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["management", "admin"])
async def test_real_generation_pipeline_uses_synced_data_and_retains_prompt_versions(role):
    session = await _session()
    try:
        await published_then_changed(session)
        settings = SimpleNamespace(ai_model="test")
        admin = InsightService(session, user("admin"), settings)
        prompt = await admin.update_prompt(
            scope="global",
            planning_year=2027,
            text="每家经销商分段说明，语言简洁。",
            expected_version=0,
        )
        assert prompt["version"] == 1 and len(prompt["versions"]) == 1
        insight = InsightService(session, user(role), settings)
        ws = await insight._workspace(2027)
        assert ws["state"]["dataBasis"] == "synced"
        assert len(ws["state"]["initiatives"]) == 1  # Unpublished project 2 omitted.
        assert ws["state"]["initiatives"][0]["rows"][0]["amount"] == 90
        evidence = build_evidence(ws, insight._scope(ws, "global"), role, 2027)
        captured = []

        async def model(body):
            captured.append(json.dumps(body, ensure_ascii=False))
            return valid_result(evidence), {}

        async def refresh():
            pass  # This test user is synthetic; production refresh is covered separately.

        insight._call_model = model
        insight._refresh_user = refresh
        record = await insight.generate(scope="global", planning_year=2027)
        assert "draft secret" not in captured[0]
        assert "每家经销商分段说明" in captured[0]
        assert record["promptVersion"] == 1
        assert record["basisLabel"] == "各项最新同步快照"
        assert record["dataVersions"][0]["revision"] == 1
        saved = await session.scalar(select(InsightRecordDO))
        before = json.dumps(saved.record, ensure_ascii=False)
        second = await admin.update_prompt(
            scope="global", planning_year=2027, text="重点说明投入变化。", expected_version=1
        )
        assert [v["version"] for v in second["versions"]] == [1, 2]
        assert json.dumps(saved.record, ensure_ascii=False) == before
        loaded = await insight.get_insight(scope="global", planning_year=2027)
        assert loaded["record"]["promptVersion"] == 1 and loaded["record"]["stale"]
        with pytest.raises(HTTPException) as error:
            await admin.update_prompt(
                scope="global", planning_year=2027, text="conflicting edit", expected_version=1
            )
        assert error.value.status_code == 409
    finally:
        await session.close()
        await session.bind.dispose()


@pytest.mark.asyncio
async def test_prompt_inherited_by_owner_and_old_result_hidden_after_resource_revocation():
    session = await _session()
    try:
        admin = InsightService(session, user("admin"), SimpleNamespace())
        await admin.update_prompt(
            scope="global", planning_year=2027, text="简洁分段。", expected_version=0
        )
        lead = InsightService(session, user("lead", ("MKT",)), SimpleNamespace())
        workspace = await lead._workspace(2027)
        descriptor = lead._scope(workspace, "MKT")
        prompt = await lead._prompt(2027, "MKT", descriptor)
        assert prompt.scope == "global" and prompt.version == 1
        session.add(
            InsightRecordDO(
                planning_year=2027,
                scope="MKT",
                signature="old",
                prompt_version=1,
                guide_version=0,
                created_by_email=lead.user.email,
                record={"access": lead._access(descriptor), "result": "old restricted data"},
            )
        )
        await session.commit()
        config = await session.get(WorkspaceConfigDO, 1)
        config.department_resources = {"MKT": []}
        await session.commit()
        assert (await lead.get_insight(scope="MKT", planning_year=2027))["record"] is None
    finally:
        await session.close()
        await session.bind.dispose()


def test_pre_upgrade_owner_records_remain_visible_but_lead_unrestricted_records_do_not():
    workspace = {"state": {"initiatives": [], "departmentResources": {"MKT": ["MRD", "SP&A"]}}}
    for role, visible in [("owner", True), ("lead", False)]:
        insight, _ = fake_insight_service(role)
        scope = "owner:owner@example.com" if role == "owner" else "MKT"
        descriptor = insight._scope(workspace, scope)
        previous = insight._access(descriptor)
        del previous["historicalResources"]
        assert insight._record_access_matches(previous, descriptor) is visible


def test_empty_synced_scope_does_not_start_a_model_request():
    for role in ("admin", "management"):
        insight, _ = fake_insight_service(role)
        with pytest.raises(HTTPException) as error:
            insight._assert_generate({"kind": "global", "items": []})
        assert error.value.status_code == 422
