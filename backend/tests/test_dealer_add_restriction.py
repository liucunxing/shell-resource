import pytest
from fastapi import HTTPException

from app.schemas.dto.workbench import InitiativeDraftUpdateDTO
from test_workspace import _owner, _session, _workspace_service


@pytest.mark.asyncio
async def test_draft_rejects_new_dealers_but_allows_existing_edits_and_removal():
    session = await _session()
    service = _workspace_service(session, _owner())
    budget = await service._scoped_budget(1, writable=True)
    await service.repository.replace_rows(budget, [{"dealerId": "d1", "amount": 10, "note": ""}])
    await session.commit()
    saved = await service.save_draft(1, InitiativeDraftUpdateDTO(
        expected_revision=0, rows=[{"dealerId": "d1", "amount": 20}]
    ))
    assert saved["rows"][0]["amount"] == 20
    with pytest.raises(HTTPException) as error:
        await service.save_draft(1, InitiativeDraftUpdateDTO(
            expected_revision=1, rows=[{"dealerId": "d1", "amount": 20}, {"dealerId": "d2", "amount": 0}]
        ))
    assert error.value.status_code == 422
    assert "新增经销商" in error.value.detail
    assert len((await service.get_draft(1))["rows"]) == 1
    saved = await service.save_draft(1, InitiativeDraftUpdateDTO(expected_revision=1, rows=[]))
    assert saved["rows"] == []
    await session.close()
