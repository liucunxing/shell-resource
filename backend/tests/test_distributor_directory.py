import pytest
from fastapi import HTTPException

from app.services.distributor_directory_service import DistributorDirectoryService


class HistoryRepository:
    async def list_dealers(self, dealer_ids=None, sectors=None):
        del dealer_ids
        rows = [
            {
                "distributor_code": "D1",
                "distributor_name": "Dealer One",
                "sector": "PCMO",
                "sd": "SD East",
                "rsm": "RSM 01",
                "distributor_status": 1,
            },
            {
                "distributor_code": "D1",
                "distributor_name": "Second organization",
                "sector": "PCMO",
                "sd": "SD East",
                "rsm": "RSM 01",
                "distributor_status": "active",
            },
            {
                "distributor_code": "D1",
                "distributor_name": "Dealer One",
                "sector": "CRTO",
                "sd": "SD East",
                "rsm": "RSM 01",
                "distributor_status": "active",
            },
            {
                "distributor_code": "D2",
                "distributor_name": None,
                "sector": None,
                "sd": None,
                "rsm": None,
                "distributor_status": "newclose",
            },
        ]
        return [row for row in rows if sectors is None or row["sector"] in sectors]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "sectors,expected",
    [
        (("PCMO",), [("D1", "PCMO"), ("D1", "PCMO")]),
        (("PCMO", "CRTO"), [("D1", "PCMO"), ("D1", "PCMO"), ("D1", "CRTO")]),
        (None, [("D1", "PCMO"), ("D1", "PCMO"), ("D1", "CRTO")]),
    ],
)
async def test_history_directory_uses_history_rows_and_sector_scope(
    sectors: tuple[str, ...] | None,
    expected: list[tuple[str, str | None]],
) -> None:
    service = DistributorDirectoryService(None, HistoryRepository())

    result = await service.list_distributors(sectors)

    assert [(row["code"], row["sector"]) for row in result] == expected
    assert result[0] == {
        "id": result[0]["id"],
        "code": "D1",
        "name": "Dealer One",
        "sector": "PCMO",
        "sd": "SD East",
        "rsm": "RSM 01",
        "status": "active",
    }


@pytest.mark.asyncio
async def test_owner_without_a_sector_cannot_load_the_directory() -> None:
    with pytest.raises(HTTPException) as error:
        await DistributorDirectoryService(None, HistoryRepository()).list_distributors(())

    assert error.value.status_code == 403
