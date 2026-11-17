from dataclasses import replace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.models.do.budget import BudgetDO
from app.models.do.planning import PlanningVersionDO
from app.models.do.workspace import UserPermissionDO
from app.schemas.dto.planning import VersionInitiativesImportDTO
from app.schemas.dto.workbench import AdminConfigDTO, AdminUsersImportDTO
from app.services.admin_service import AdminService
from test_planning_workflow import prepare, user
from test_workspace import _session, _workspace_service


async def users_setup():
    session = await _session()
    session.add_all([
        UserPermissionDO(email="admin@example.com", display_name="Admin", role="admin",
                         department=[], sector=[], enabled=True,
                         affiliation_sector="PCMO", affiliation_department="MKT"),
        UserPermissionDO(email="lead@example.com", display_name="Lead", role="lead",
                         department=["MKT"], sector=["PCMO"], enabled=True,
                         affiliation_sector="PCMO", affiliation_department="MKT"),
    ])
    await session.commit()
    return session, AdminService(session, user("admin@example.com", "admin"))


def person(email="new@example.com", role="owner", **patch):
    return {
        "email": email, "display_name": "New", "role": role,
        "department": ["MKT"], "sector": ["PCMO"], "enabled": True,
        "affiliation_sector": "PCMO", "affiliation_department": "MKT", **patch,
    }


@pytest.mark.asyncio
async def test_users_import_preview_commit_and_stale_revision():
    session, service = await users_setup()
    revision = await service.users_revision()
    data = dict(expected_revision=revision, items=[person()])
    assert (await service.import_users(AdminUsersImportDTO(**data)))["created"] == 1
    assert await service.users_revision() == revision
    result = await service.import_users(AdminUsersImportDTO(**data, preview=False))
    assert result["created"] == 1 and result["revision"] != revision
    with pytest.raises(HTTPException) as error:
        await service.import_users(AdminUsersImportDTO(**data, preview=False))
    assert error.value.status_code == 409
    await session.close()


@pytest.mark.asyncio
async def test_users_import_invalid_final_scope_last_admin_and_preview_identity():
    session, service = await users_setup()
    revision = await service.users_revision()
    for rows in [
        [person(), person("bad@example.com", sector=["B2B"])],
        [person("admin@example.com", "admin", enabled=False, department=[], sector=[])],
        [person("a@example.com", display_name="Changed existing owner")],
    ]:
        with pytest.raises(HTTPException):
            await service.import_users(AdminUsersImportDTO(
                expected_revision=revision, items=rows, preview=False,
            ))
        assert await service.users_revision() == revision
    preview_service = AdminService(
        session, replace(service.user, preview_actor_email="other@x.com"),
    )
    with pytest.raises(HTTPException) as error:
        await preview_service.import_users(AdminUsersImportDTO(
            expected_revision=revision, items=[person()],
        ))
    assert error.value.status_code == 403
    await session.close()


@pytest.mark.asyncio
async def test_users_batch_lead_and_owner_validate_final_state_not_row_order():
    session, service = await users_setup()
    result = await service.import_users(AdminUsersImportDTO(
        expected_revision=await service.users_revision(), preview=False,
        items=[person("b2b@example.com", sector=["B2B"]),
               person("b2b-lead@example.com", "lead", sector=["B2B"])],
    ))
    assert result["created"] == 2
    await session.close()


@pytest.mark.asyncio
async def test_users_import_tolerates_unrelated_legacy_gaps_but_rejects_new_gaps():
    session, service = await users_setup()
    session.add(UserPermissionDO(
        email="legacy@example.com", display_name="Legacy", role="owner",
        department=["ICE"], sector=["B2B"], enabled=True,
        affiliation_sector="B2B", affiliation_department="ICE",
    ))
    await session.commit()
    revision = await service.users_revision()
    unrelated = dict(
        expected_revision=revision,
        items=[person("manager@example.com", "management", department=[], sector=[])],
    )
    assert (await service.import_users(AdminUsersImportDTO(**unrelated)))["created"] == 1
    assert await service.users_revision() == revision
    saved = await service.import_users(AdminUsersImportDTO(**unrelated, preview=False))
    revision = saved["revision"]
    for changes in [
        [person("lead@example.com", "lead", enabled=False)],
        [person("uncovered@example.com", department=["ICE"], sector=["B2B"])],
        [person("legacy@example.com", sector=["PCMO"], department=["ICE"])],
    ]:
        with pytest.raises(HTTPException) as error:
            await service.import_users(AdminUsersImportDTO(
                expected_revision=revision, items=changes, preview=False,
            ))
        assert error.value.status_code == 422
        assert await service.users_revision() == revision
    await session.close()


@pytest.mark.asyncio
async def test_version_import_atomic_preview_and_revision():
    session, service, budgets = await prepare()
    budget_id = budgets[0].id
    item = dict(id=budget_id, name="Imported", sector="PCMO", department="MKT",
                resourceType="MRD", ownerId="a@example.com", budget=100,
                enabled=True, reason="修正归属")
    before_name = budgets[0].initiative_name
    payload = dict(expected_revision=1, items=[item])
    result = await service.import_initiatives("202701", VersionInitiativesImportDTO(**payload))
    assert result["version"]["revision"] == 1
    assert (await session.get(BudgetDO, budget_id)).initiative_name == before_name
    with pytest.raises(HTTPException):
        await service.import_initiatives("202701", VersionInitiativesImportDTO(
            expected_revision=1, preview=False,
            items=[item, {**item, "id": None, "name": "Bad", "ownerId": "missing@example.com"}],
        ))
    assert (await session.get(BudgetDO, budget_id)).initiative_name == before_name
    assert (await session.get(PlanningVersionDO, "202701")).revision == 1
    result = await service.import_initiatives(
        "202701", VersionInitiativesImportDTO(**payload, preview=False),
    )
    assert result["version"]["revision"] == 2
    assert (await session.get(BudgetDO, budget_id)).initiative_name == "Imported"
    assert result["version"]["published"] is True
    assert result["version"]["open"] is True
    await session.close()


@pytest.mark.asyncio
async def test_legend_colors_roundtrip_and_workspace_projection():
    session, service = await users_setup()
    result = await service.update_config(AdminConfigDTO(
        expected_revision=0,
        legendColors={"resources": {"MRD": "#abcdef"}, "initiatives": {"key": "#001122"}},
    ))
    assert result["legendColors"]["resources"]["MRD"] == "#ABCDEF"
    workspace = await _workspace_service(session, user()).get_workspace(2027)
    assert workspace["state"]["legendColors"] == result["legendColors"]
    cleared = await service.update_config(AdminConfigDTO(expected_revision=1, legendColors={}))
    assert cleared["legendColors"] == {}
    await session.close()


def test_import_and_color_validation():
    for value in [{"resources": {"MRD": "red"}}, {"unknown": {}}, {"resources": {"": "#123456"}}]:
        with pytest.raises(ValidationError):
            AdminConfigDTO(expected_revision=0, legendColors=value)
    with pytest.raises(ValidationError):
        AdminUsersImportDTO(expected_revision="a" * 64, items=[person(), person()])
