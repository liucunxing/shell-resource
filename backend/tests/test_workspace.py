"""SQLite attached-schema service tests; they exercise transactions, not PostgreSQL DDL."""

from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.dependencies.workbench_user import WorkbenchUser
from app.models.do.base import BaseDO
from app.models.do.budget import BudgetDO
from app.models.do.distributor_history import distributor_sellin_resource_history
from app.models.do.workspace import UserPermissionDO, WorkspaceConfigDO
from app.schemas.dto.workbench import InitiativeDraftUpdateDTO, PublishDTO
from app.services.workspace_service import WorkspaceService


async def _session() -> AsyncSession:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.exec_driver_sql("ATTACH DATABASE ':memory:' AS data")
        await connection.run_sync(BaseDO.metadata.create_all)
    session = AsyncSession(engine, expire_on_commit=False)
    session.add_all(
        [
            BudgetDO(
                id=1,
                planning_year=2027,
                sector="PCMO",
                department="MKT",
                resource_type="R",
                initiative_name="A",
                plan_budget_amount=Decimal("100"),
                allocate_budget_amount=0,
                owner_email="a@example.com",
                revision=0,
                status=0,
                input_source="TEST",
            ),
            BudgetDO(
                id=2,
                planning_year=2027,
                sector="PCMO",
                department="MKT",
                resource_type="R",
                initiative_name="B",
                plan_budget_amount=Decimal("100"),
                allocate_budget_amount=0,
                owner_email="b@example.com",
                revision=0,
                status=0,
                input_source="TEST",
            ),
            UserPermissionDO(
                id=1,
                email="a@example.com",
                display_name="A",
                role="owner",
                department="MKT",
                sector=["PCMO"],
                enabled=True,
            ),
            WorkspaceConfigDO(
                id=1,
                revision=0,
                budget_reasons=[{"id": "misc", "enabled": True}],
                budget_reason_version=1,
                guide={"version": 3, "text": "g"},
                reference={},
            ),
        ]
    )
    await session.execute(
        distributor_sellin_resource_history.insert(),
        [
            {
                "distributor_code": "d1",
                "distributor_name": "Dealer 1",
                "sector": "PCMO",
                "distributor_status": "1",
            },
            {
                "distributor_code": "d2",
                "distributor_name": "Dealer 2",
                "sector": "PCMO",
                "distributor_status": "1",
            },
            {
                "distributor_code": "d3",
                "distributor_name": "Dealer 3",
                "sector": "CRTO",
                "distributor_status": "1",
            },
        ],
    )
    await session.commit()
    return session


def _owner() -> WorkbenchUser:
    return WorkbenchUser("a@example.com", "owner", "MKT", "A", ("PCMO",))


class StubDirectoryService:
    async def distributor_codes(self, _sectors: tuple[str, ...]) -> set[str]:
        return {"d1", "d2"}


def _workspace_service(session: AsyncSession, user: WorkbenchUser) -> WorkspaceService:
    return WorkspaceService(session, user, StubDirectoryService())


@pytest.mark.asyncio
async def test_profile_metadata_contacts_and_preview_target() -> None:
    session = await _session()
    session.add_all([
        UserPermissionDO(id=2, email="admin@example.test", display_name="Admin",
                         role="admin", department=[], enabled=True),
        UserPermissionDO(id=3, email="disabled@example.test", display_name="Disabled",
                         role="admin", department=[], enabled=False),
    ])
    await session.commit()
    target = WorkbenchUser(
        "a@example.com", "owner", "MKT", "A", ("PCMO",),
        preview_actor_email="admin@example.test", preview_actor_label="Admin",
        affiliation_sector="PCMO", affiliation_department="ICE",
    )
    workspace = await _workspace_service(session, target).get_workspace(2027)
    identity = workspace["identity"]
    assert identity["userId"] == "1"
    assert identity["roles"] == ["owner"]
    assert identity["affiliation_department"] == "ICE"
    assert identity["department"] == ["MKT"]
    assert identity["adminContacts"] == [{"name": "Admin", "email": "admin@example.test"}]
    assert workspace["users"] == []
    assert identity["preview"]["actorEmail"] == "admin@example.test"
    await session.close()


@pytest.mark.asyncio
async def test_profile_metadata_missing_configuration() -> None:
    session = await _session()
    identity = await _workspace_service(
        session, WorkbenchUser("unknown@example.test", "owner", "MKT", "Unknown")
    )._profile_identity()
    assert identity["userId"] is None
    assert identity["adminContacts"] == []
    await session.close()


@pytest.mark.asyncio
async def test_owner_isolated_revision_and_immutable_publish() -> None:
    session = await _session()
    service = _workspace_service(session, _owner())
    payload = InitiativeDraftUpdateDTO(
        expected_revision=0, rows=[{"dealerId": "d1", "amount": "100", "note": "x"}]
    )
    saved = await service.save_draft(1, payload)
    assert saved["revision"] == 1
    with pytest.raises(HTTPException) as blocked:
        await service.get_draft(2)
    assert blocked.value.status_code == 404
    with pytest.raises(HTTPException) as stale:
        await service.save_draft(1, payload)
    assert stale.value.status_code == 409
    publication = await service.publish(1, PublishDTO(expected_revision=1, note="ok"))
    assert publication["publishedRevision"] == 1
    await service.save_draft(1, InitiativeDraftUpdateDTO(expected_revision=1, rows=[]))
    history = await service.publications(1)
    assert history[0]["initiative"]["rows"][0]["amount"] == 100.0
    await session.close()


@pytest.mark.asyncio
async def test_role_read_boundaries() -> None:
    session = await _session()
    lead = _workspace_service(session, WorkbenchUser("lead@example.com", "lead", "MKT", "Lead"))
    assert (await lead.get_draft(1))["id"] == "1"
    assert await lead.publications(1) == []
    with pytest.raises(HTTPException) as denied:
        await lead.save_draft(1, InitiativeDraftUpdateDTO(expected_revision=0))
    assert denied.value.status_code == 403
    for role in ("management", "admin"):
        service = _workspace_service(session, WorkbenchUser("x@example.com", role, "MKT", "X"))
        if role == "admin":
            assert (await service.get_draft(1))["id"] == "1"
        else:
            with pytest.raises(HTTPException) as denied:
                await service.get_draft(1)
            assert denied.value.status_code == 403
    await session.close()


@pytest.mark.asyncio
async def test_admin_and_management_keep_all_dealers_but_only_home_department_fees() -> None:
    session = await _session()
    for role in ("admin", "management"):
        service = _workspace_service(
            session,
            WorkbenchUser(
                f"{role}@example.com", role, "MKT", role.title(),
                affiliation_sector="PCMO", affiliation_department="MKT",
                history_resources=("MRD", "SP&A", "ICE Rebate", "Capex"),
            ),
        )
        dealers = (await service.get_workspace(2027))["data"]["dealers"]
        assert [dealer["id"] for dealer in dealers] == ["d1", "d2", "d3"]
        assert [dealer["name"] for dealer in dealers] == ["Dealer 1", "Dealer 2", "Dealer 3"]
        assert set(dealers[0]["history"]["resources2025"]) == {
            "MRD",
            "SP&A",
        }
        assert "totalInvestment2025" in dealers[0]["history"]
        assert "yield" in dealers[0]["history"]

    await session.close()


@pytest.mark.asyncio
async def test_owner_history_is_limited_to_authorized_sectors() -> None:
    session = await _session()
    dealers = (await _workspace_service(session, _owner()).get_workspace(2027))["data"]["dealers"]
    assert [dealer["id"] for dealer in dealers] == ["d1", "d2"]
    await session.close()


@pytest.mark.asyncio
async def test_closed_existing_allocation_is_excluded_from_workspace_and_save() -> None:
    session = await _session()
    service = WorkspaceService(session, _owner())
    await service.save_draft(
        1, InitiativeDraftUpdateDTO(expected_revision=0, rows=[{"dealerId": "d1", "amount": 50}])
    )
    await session.execute(
        distributor_sellin_resource_history.update().values(distributor_status="0")
    )
    await session.commit()
    workspace = await service.get_workspace(2027)
    assert workspace["data"]["dealers"] == []
    assert all(not item["rows"] for item in workspace["state"]["initiatives"])
    with pytest.raises(HTTPException) as denied:
        await service.save_draft(
            1,
            InitiativeDraftUpdateDTO(expected_revision=1, rows=[{"dealerId": "d1", "amount": 100}]),
        )
    assert denied.value.status_code == 422
    assert "active" in denied.value.detail
    await session.close()


@pytest.mark.asyncio
async def test_same_code_different_organization_survives_save_and_publish() -> None:
    from app.services.distributor_directory_service import DistributorDirectoryService

    session = await _session()
    await session.execute(
        distributor_sellin_resource_history.insert(),
        [
            {
                "distributor_code": "shared",
                "sector": "PCMO",
                "sd": "East",
                "rsm": "One",
                "distributor_status": "1",
            },
            {
                "distributor_code": "shared",
                "sector": "PCMO",
                "sd": "East",
                "rsm": "Two",
                "distributor_status": "1",
            },
        ],
    )
    await session.commit()
    choices = [
        row
        for row in await DistributorDirectoryService(session).list_distributors(("PCMO",))
        if row["code"] == "shared"
    ]
    assert len({row["id"] for row in choices}) == 2
    service = WorkspaceService(session, _owner())
    saved = await service.save_draft(
        1,
        InitiativeDraftUpdateDTO(
            expected_revision=0,
            rows=[
                {"dealerId": choices[0]["id"], "amount": 40},
                {"dealerId": choices[1]["id"], "amount": 60},
            ],
        ),
    )
    assert [row["dealerCode"] for row in saved["rows"]] == ["shared", "shared"]
    assert {row["rsm"] for row in saved["rows"]} == {"One", "Two"}
    published = await service.publish(1, PublishDTO(expected_revision=1))
    assert {row["dealerId"] for row in published["initiative"]["rows"]} == {
        row["id"] for row in choices
    }
    await session.close()


@pytest.mark.asyncio
async def test_reference_metadata_uses_history_source_for_workspace_and_snapshot() -> None:
    session = await _session()
    service = _workspace_service(session, _owner())
    result = await service.get_workspace(2027)
    manifest = result["state"]["reference"]
    assert manifest["batchId"] == "data.distributor_sellin_resource_history"
    assert manifest["asOf"] is None
    assert manifest["planningYear"] == 2027
    assert manifest["count"] == 2  # Only authorized PCMO records, not the whole table.
    assert result["data"]["historySnapshot"] == {
        "manifest": manifest, "records": result["data"]["dealers"],
    }
    await service.save_draft(
        1, InitiativeDraftUpdateDTO(expected_revision=0, rows=[{"dealerId": "d1", "amount": "100"}])
    )
    published = await service.publish(1, PublishDTO(expected_revision=1))
    assert published["reference"] == result["state"]["reference"]
    later = await service.get_workspace(2028)
    assert later["state"]["reference"]["planningYear"] == 2028
    await session.close()
