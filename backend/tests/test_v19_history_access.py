from dataclasses import replace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select

from app.core.resource_access import (
    RESOURCE_TYPES,
    historical_resource_access,
    validate_submission_reasons,
)
from app.dependencies.workbench_user import WorkbenchUser, resolve_workbench_permission
from app.models.do.workspace import UserPermissionDO, WorkspaceConfigDO, WorkspacePublicationDO
from app.portal_embed.session import fingerprint, workbench_user
from app.schemas.dto.workbench import AdminConfigDTO, AdminUserDTO
from app.services.admin_service import AdminService
from app.services.reference_service import ReferenceService
from test_workspace import _session


def person(role="owner", **overrides):
    return WorkbenchUser(
        "a@example.com", role, ["MKT", "ICE"], "A", ("PCMO",),
        affiliation_sector=overrides.get("affiliation_sector", "PCMO"),
        affiliation_department=overrides.get("affiliation_department", "MKT"),
        history_resources=overrides.get("history_resources"),
    )


def test_management_uses_only_valid_sector_grants_for_expenses():
    manager = person("management", affiliation_department=None, history_resources=())
    assert historical_resource_access(manager, {"MKT": []})["resources"] == list(RESOURCE_TYPES)
    for invalid in [(), ("UNKNOWN",), ("PCMO", "PCMO")]:
        assert historical_resource_access(replace(manager, sectors=invalid))["resources"] == []


@pytest.mark.parametrize("role", ["owner", "lead"])
def test_business_departments_define_expense_union(role):
    user = person(role, affiliation_department=None, history_resources=())
    access = historical_resource_access(user, {"ICE": []})
    assert access["resources"] == ["MRD", "SP&A", "ICE Rebate"]
    assert historical_resource_access(replace(user, department="CAPEX"))["resources"] == ["Capex"]
    assert historical_resource_access(replace(user, department=[]))["resources"] == []


def test_admin_retains_existing_department_ceiling_and_individual_restrictions():
    admin = person("admin")
    assert historical_resource_access(admin, {"MKT": ["Capex", "MRD"]})["resources"] == ["MRD"]
    assert historical_resource_access(replace(admin, history_resources=()))["resources"] == []
    missing = replace(admin, affiliation_department=None)
    assert historical_resource_access(missing)["resources"] == []


@pytest.mark.parametrize("role", ["owner", "lead", "management", "admin"])
def test_user_changes_follow_role_authorization(role):
    body = dict(email="new@example.com", display_name="New", role=role,
                department=["ICE"] if role in {"owner", "lead"} else [],
                sector=["PCMO"] if role != "admin" else [])
    if role == "admin":
        with pytest.raises(ValidationError):
            AdminUserDTO(**body)
    else:
        assert AdminUserDTO(**body).affiliation_department is None
    payload = AdminUserDTO(**body, affiliation_sector="b2b", affiliation_department="mkt")
    assert payload.department == body["department"]
    assert payload.sector == body["sector"]
    assert payload.affiliation_sector == "B2B"


@pytest.mark.asyncio
async def test_header_and_portal_identities_use_same_expense_override_and_revocation_fingerprint():
    session = await _session()
    try:
        permission = await session.scalar(select(UserPermissionDO))
        permission.affiliation_sector = "PCMO"
        permission.affiliation_department = "MKT"
        permission.history_resources = ["Capex"]
        await session.commit()
        header_user = await resolve_workbench_permission(session, permission.email)
        portal_user = workbench_user(permission)
        assert historical_resource_access(header_user) == historical_resource_access(portal_user)
        old = fingerprint(permission)
        permission.history_resources = []
        assert fingerprint(permission) != old
        assert permission.department == ["MKT"]
    finally:
        await session.close()
        await session.bind.dispose()


@pytest.mark.asyncio
async def test_reference_user_scope_cannot_be_widened_by_explicit_sector_argument():
    session = await _session()
    try:
        dealers = await ReferenceService(session).get_dealers(
            2027, sectors=("PCMO", "CRTO"), user=person(history_resources=())
        )
        assert {row["id"] for row in dealers} == {"d1", "d2"}
        expected = {"MRD", "SP&A", "ICE Rebate"}
        assert all(set(row["history"]["resources2025"]) == expected for row in dealers)
        assert all("totalInvestment2025" in row["history"] for row in dealers)
        assert all(row["history"]["totalInvestment2025"] is None for row in dealers)
    finally:
        await session.close()
        await session.bind.dispose()


@pytest.mark.asyncio
async def test_reason_used_only_in_submitted_snapshot_cannot_be_renamed_or_deleted():
    session = await _session()
    try:
        config = await session.get(WorkspaceConfigDO, 1)
        config.budget_reasons = [{"id": "reserve", "label": "固定预留", "enabled": True}]
        session.add(WorkspacePublicationDO(
            budget_id=1, department="MKT", publication_number=1, published_revision=0,
            snapshot={"initiative": {"otherBudgets": [{"reasonId": "reserve", "amount": 10}]}},
        ))
        await session.commit()
        service = AdminService(session, replace(person(), role="admin"))
        for reasons in (
            [{"id": "reserve", "label": "换个名称", "enabled": True}],
            [{"id": "new", "label": "新原因", "enabled": True}],
        ):
            with pytest.raises(HTTPException) as error:
                await service.update_config(
                    AdminConfigDTO(expected_revision=0, budgetReasons=reasons)
                )
            assert error.value.status_code == 422
        updated = await service.update_config(AdminConfigDTO(expected_revision=0, budgetReasons=[
            {"id": "reserve", "label": "固定预留", "enabled": False},
            {"id": "new", "label": "新原因", "enabled": True},
        ]))
        assert updated["budgetReasons"][0]["enabled"] is False
    finally:
        await session.close()
        await session.bind.dispose()


def test_submission_uses_fixed_enabled_reason_even_when_note_claims_valid_name():
    reasons = [{"id": "fixed", "label": "固定原因", "enabled": True},
               {"id": "disabled", "label": "已停用", "enabled": False}]
    for reason in ("disabled", "unknown"):
        with pytest.raises(ValueError):
            validate_submission_reasons(reasons, [{"reasonId": reason, "note": "固定原因"}])
    validate_submission_reasons(reasons, [{"reasonId": "fixed", "note": ""}])


def test_reason_catalog_keeps_an_enabled_unique_label_and_thresholds_are_ordered():
    with pytest.raises(ValidationError):
        AdminConfigDTO(expected_revision=0, budgetReasons=[
            {"id": "fixed", "label": "停用原因", "enabled": False}])
    with pytest.raises(ValidationError):
        AdminConfigDTO(expected_revision=0, healthThresholds={
            "concentrationYellow": 10, "concentrationRed": 5, "dealerYellow": 3, "dealerRed": 6})
