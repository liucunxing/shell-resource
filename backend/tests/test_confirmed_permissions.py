"""Current permission matrix for drafts, submitted snapshots and historical metrics."""

from dataclasses import replace

import pytest
from fastapi import HTTPException

from app.dependencies.workbench_user import WorkbenchUser
from app.schemas.dto.workbench import AdminConfigDTO, InitiativeDraftUpdateDTO, PublishDTO
from app.services.admin_service import AdminService
from app.services.workspace_service import WorkspaceService
from test_workspace import _owner, _session, _workspace_service


def user(role, department=()):
    return WorkbenchUser(f"{role}@example.com", role, department, role, ("PCMO",),
                         affiliation_sector="PCMO", affiliation_department="MKT")


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
async def test_authorized_department_union_controls_expenses_without_expanding_business_scope():
    session = await _session()
    try:
        admin = AdminService(session, user("admin"))
        result = await admin.update_config(
            AdminConfigDTO(
                expected_revision=0,
                departmentResources={"MKT": ["MRD"], "ICE": ["SP&A"], "CAPEX": ["Capex"]},
            )
        )
        assert result["departmentResources"]["ICE"] == ["SP&A"]
        for role in ("owner", "lead"):
            ws = await WorkspaceService(session, user(role, ("MKT", "ICE"))).get_workspace(2027)
            assert {row["id"] for row in ws["data"]["dealers"]} == {"d1", "d2"}
            for row in ws["data"]["dealers"]:
                assert set(row["history"]["resources2025"]) == {"MRD", "SP&A", "ICE Rebate"}
                assert row["history"]["restrictedResources2025"] == ["Capex"]
                assert "yield" in row["history"]
                assert "totalInvestment2025" in row["history"]
        # A missing home affiliation denies detail even for a privileged role.
        missing = replace(user("admin"), affiliation_department=None)
        ws = await WorkspaceService(session, missing).get_workspace(2027)
        assert ws["data"]["dealers"][0]["history"]["resources2025"] == {}
        with pytest.raises(HTTPException) as error:
            await AdminService(session, user("lead", ("MKT",))).update_config(
                AdminConfigDTO(expected_revision=1, departmentResources={})
            )
        assert error.value.status_code == 403
    finally:
        await session.close()
        await session.bind.dispose()
