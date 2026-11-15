"""Read-time legacy identity compatibility never rewrites immutable source snapshots."""

from copy import deepcopy

import pytest
from tests.test_planning_legacy_identity import legacy_submission
from tests.test_workspace import _owner, _session

from app.dependencies.workbench_user import WorkbenchUser
from app.models.do.distributor_history import distributor_sellin_resource_history
from app.repositories.workspace_repository import WorkspaceRepository
from app.schemas.dto.workbench import InitiativeDraftUpdateDTO
from app.services.workspace_service import WorkspaceService


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["owner", "lead", "management", "admin"])
async def test_workspace_and_publications_match_legacy_codes_only_within_sector(role):
    session = await _session()
    try:
        publication = await legacy_submission(session)
        publication.snapshot = {**publication.snapshot, "initiative": {
            **publication.snapshot["initiative"], "selected": ["d1"],
        }}
        await session.commit()
        original_snapshot = deepcopy(publication.snapshot)
        await session.execute(distributor_sellin_resource_history.insert().values(
            distributor_code="d1", distributor_name="Other sector", sector="CRTO",
            sd="OTHER-SD", rsm="OTHER-RSM", distributor_status="1",
        ))
        await session.commit()
        identity = WorkbenchUser(
            "a@example.com" if role == "owner" else f"{role}@example.com",
            role, "MKT", role, ("PCMO",),
        )
        service = WorkspaceService(session, identity)
        workspace = await service.get_workspace(2027)
        dealer = next(item for item in workspace["data"]["dealers"]
                      if item["code"] == "d1" and item["sector"] == "PCMO")
        assert dealer["id"].startswith("history:")
        initiative = next(item for item in workspace["state"]["initiatives"] if item["id"] == "1")
        row = initiative["rows"][0]
        assert row["dealerId"] == dealer["id"]
        assert row["dealerCode"] == "d1"
        assert row["sd"] == "SD-A"
        assert row["rsm"] == "RSM-A"
        assert row["amount"] == 100
        assert workspace["state"]["publications"]["1"][0]["initiative"]["rows"][0][
            "dealerId"
        ] == dealer["id"]
        assert workspace["state"]["publications"]["1"][0]["initiative"]["selected"] == [
            dealer["id"],
        ]
        history = await service.publications(1)
        assert history[0]["initiative"]["rows"][0]["dealerId"] == dealer["id"]
        assert history[0]["initiative"]["selected"] == [dealer["id"]]
        if role != "management":
            draft = await service.get_draft(1)
            assert draft["rows"][0]["dealerId"] == dealer["id"]
        # Detached serialization must not mutate ORM JSON or persisted allocation IDs.
        assert publication.snapshot == original_snapshot
        assert publication.snapshot["initiative"]["rows"][0]["dealerId"] == "d1"
        stored = (await WorkspaceRepository(session).rows_for(1))[0]
        assert stored.history_key is None
        assert stored.distributor_code == "d1"
        assert stored.sd is None and stored.rsm is None
    finally:
        await session.close()
        await session.bind.dispose()


@pytest.mark.asyncio
async def test_roster_without_allocation_rows_uses_same_safe_projection():
    session = await _session()
    try:
        await legacy_submission(session)
        service = WorkspaceService(session, _owner())
        original = {"sector": "PCMO", "selected": ["d1"], "rows": []}
        result = (await service._project_legacy_items([original]))[0]
        assert result["selected"][0].startswith("history:")
        assert result["rows"] == []
        assert original["selected"] == ["d1"]
    finally:
        await session.close()
        await session.bind.dispose()


@pytest.mark.asyncio
async def test_owner_can_save_existing_closed_legacy_dealer_using_projected_identity():
    session = await _session()
    try:
        publication = await legacy_submission(session)
        original_snapshot = deepcopy(publication.snapshot)
        await session.execute(
            distributor_sellin_resource_history.update()
            .where(distributor_sellin_resource_history.c.distributor_code == "d1")
            .values(distributor_status="0")
        )
        await session.commit()
        service = WorkspaceService(session, _owner())
        draft = await service.get_draft(1)
        identity = draft["rows"][0]["dealerId"]
        assert identity.startswith("history:")
        saved = await service.save_draft(1, InitiativeDraftUpdateDTO(
            expected_revision=draft["revision"], rows=[{"dealerId": identity, "amount": 100}],
        ))
        assert saved["rows"][0]["dealerId"] == identity
        assert saved["rows"][0]["dealerCode"] == "d1"
        assert publication.snapshot == original_snapshot
        assert publication.snapshot["initiative"]["rows"][0]["dealerId"] == "d1"
    finally:
        await session.close()
        await session.bind.dispose()


@pytest.mark.parametrize("sector,rows,dealers", [
    ("PCMO", [{"dealerId": "d1", "amount": 100}], [
        {"id": "history:other", "code": "d1", "sector": "CRTO"},
    ]),
    ("PCMO", [{"dealerId": "d1", "amount": 100}], [
        {"id": "history:a", "code": "d1", "sector": "PCMO"},
        {"id": "history:b", "code": "d1", "sector": "PCMO"},
    ]),
    (None, [{"dealerId": "d1", "amount": 100}], [
        {"id": "history:a", "code": "d1", "sector": "PCMO"},
    ]),
    ("PCMO", [{"dealerId": "history:old", "dealerCode": "d1", "amount": 100}], [
        {"id": "history:new", "code": "d1", "sector": "PCMO"},
    ]),
    ("PCMO", [{"dealerId": "d1", "amount": 40},
              {"dealerId": "history:a", "dealerCode": "d1", "amount": 60}], [
        {"id": "history:a", "code": "d1", "sector": "PCMO"},
    ]),
    ("PCMO", [{"dealerId": "d1", "amount": 100, "sd": "OLD-SD", "rsm": "RSM-A"}], [
        {"id": "history:a", "code": "d1", "sector": "PCMO", "sd": "SD-A", "rsm": "RSM-A"},
    ]),
    ("PCMO", [{"dealerId": "d1", "amount": 100, "sd": "SD-A", "rsm": "OLD-RSM"}], [
        {"id": "history:a", "code": "d1", "sector": "PCMO", "sd": "SD-A", "rsm": "RSM-A"},
    ]),
])
def test_unmatched_ambiguous_or_colliding_rows_are_not_guessed_or_merged(sector, rows, dealers):
    original = {"sector": sector, "rows": rows}
    before = deepcopy(original)
    projected = WorkspaceService._project_dealer_identities(original, dealers)
    assert projected == before
    assert original == before
    assert projected["rows"] is not original["rows"]


def test_matching_saved_organization_is_preserved_while_missing_organization_is_filled():
    original = {"sector": "PCMO", "rows": [
        {"dealerId": "d1", "amount": 100, "sd": "SD-A", "rsm": None},
    ]}
    projected = WorkspaceService._project_dealer_identities(original, [
        {"id": "history:a", "code": "d1", "sector": "PCMO", "sd": "SD-A", "rsm": "RSM-A"},
    ])
    assert projected["rows"][0]["dealerId"] == "history:a"
    assert projected["rows"][0]["sd"] == "SD-A"
    assert projected["rows"][0]["rsm"] == "RSM-A"
    assert original["rows"][0]["rsm"] is None


def test_selected_roster_and_allocations_are_projected_together_without_mutating_snapshot():
    original = {"sector": "PCMO", "selected": ["d2", "d1", "unknown"], "rows": [
        {"dealerId": "d1", "amount": 70}, {"dealerId": "d2", "amount": 30},
    ]}
    before = deepcopy(original)
    projected = WorkspaceService._project_dealer_identities(original, [
        {"id": "history:a", "code": "d1", "sector": "PCMO"},
        {"id": "history:b", "code": "d2", "sector": "PCMO"},
        {"id": "history:other", "code": "d1", "sector": "CRTO"},
    ])
    assert projected["selected"] == ["history:b", "history:a", "unknown"]
    assert [(row["dealerId"], row["amount"]) for row in projected["rows"]] == [
        ("history:a", 70), ("history:b", 30),
    ]
    assert original == before


def test_selected_roster_does_not_bypass_saved_organization_conflict():
    original = {"sector": "PCMO", "selected": ["d1"], "rows": [
        {"dealerId": "d1", "amount": 100, "sd": "OLD-SD"},
    ]}
    projected = WorkspaceService._project_dealer_identities(original, [
        {"id": "history:a", "code": "d1", "sector": "PCMO", "sd": "NEW-SD"},
    ])
    assert projected == original
