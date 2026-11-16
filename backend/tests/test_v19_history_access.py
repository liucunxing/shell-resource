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


@pytest.mark.parametrize("role", ["owner", "lead", "management", "admin"])
def test_missing_home_affiliation_denies_expense_columns_for_every_role(role):
    assert historical_resource_access(person(role, affiliation_department=None), {}, {}) == {
        "source": "missing-department", "resources": [],
    }
    assert historical_resource_access(person(role, affiliation_sector="UNKNOWN"))["resources"] == []


def test_department_ceiling_intersects_configuration_and_user_override():
    mapping = {"MKT": ["MRD"], "ICE": ["SP&A"], "PCMO|MKT": ["Capex"]}
    assert historical_resource_access(person(), mapping)["resources"] == []
    assert historical_resource_access(person(history_resources=()), mapping)["resources"] == []
    assert historical_resource_access(person(history_resources=("SP&A",)), mapping) == {
        "source": "user", "resources": [],
    }
    assert historical_resource_access(person(), {"MKT": ["MRD"]})["resources"] == ["MRD"]
    assert historical_resource_access(person("admin"), {})["resources"] == ["MRD", "SP&A"]
    assert historical_resource_access(person("owner"), {})["resources"] == ["MRD", "SP&A"]
    assert historical_resource_access(
        person(history_resources=("MRD", "SP&A")), {"MKT": ["MRD"]},
    )["resources"] == ["MRD"]


@pytest.mark.parametrize("role", ["owner", "lead", "management", "admin"])
@pytest.mark.parametrize("department,expected", [
    ("MKT", ["MRD", "SP&A"]), ("ICE", ["SP&A", "ICE Rebate"]), ("CAPEX", ["Capex"]),
])
def test_every_role_and_explicit_override_stay_inside_home_department(role, department, expected):
    user = person(role, affiliation_department=department, history_resources=RESOURCE_TYPES)
    assert historical_resource_access(
        user, {department: list(RESOURCE_TYPES)}, {role: list(RESOURCE_TYPES)},
    )["resources"] == expected


@pytest.mark.parametrize("role", ["owner", "lead", "management", "admin"])
def test_user_changes_require_explicit_home_affiliation_without_changing_authorized_scope(role):
    body = dict(email="new@example.com", display_name="New", role=role,
                department=["ICE"] if role in {"owner", "lead"} else [],
                sector=["PCMO"] if role in {"owner", "lead"} else [])
    with pytest.raises(ValidationError):
        AdminUserDTO(**body)
    payload = AdminUserDTO(**body, affiliation_sector="b2b", affiliation_department="mkt")
    assert payload.department == body["department"]
    assert payload.sector == body["sector"]
    assert payload.affiliation_sector == "B2B"
    with pytest.raises(ValidationError):
        AdminUserDTO(**body, affiliation_sector="PCMO", affiliation_department="UNKNOWN")


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
        assert all(row["history"]["resources2025"] == {} for row in dealers)
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
