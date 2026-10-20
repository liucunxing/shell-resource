import asyncio

from app.services.reference_service import ReferenceService


def history_row(name: str) -> dict:
    return {
        "distributor_code": "D-DUPLICATE",
        "distributor_name": name,
        "volume_2024": 1,
        "c3_2024": 2,
        "volume_2025": 3,
        "c3_2025": 4,
        "volume_2026": 5,
        "c3_2026": 6,
        "mrd_2025": 7,
        "reb_2025": 8,
        "btl_2025": 9,
        "capex_2025": 10,
        "yield_2025": 11,
        "sector": "PCMO",
    }


class DuplicateReferenceRepository:
    async def list_dealers(self, dealer_ids=None, sectors=None):
        del dealer_ids, sectors
        return [
            history_row("Duplicate Dealer"),
            history_row("Duplicate Dealer Alias"),
            {**history_row("Duplicate Dealer"), "sector": "CRTO", "volume_2025": 999},
        ]

def test_reference_results_preserve_sectors_for_the_same_distributor_code():
    async def run():
        service = ReferenceService(None)
        service.repository = DuplicateReferenceRepository()

        dealers = await service.get_dealers(2027)
        assert [(item["id"], item["sector"]) for item in dealers] == [
            ("D-DUPLICATE", "PCMO"), ("D-DUPLICATE", "CRTO"),
        ]
        assert [item["history"]["vol2025"] for item in dealers] == [3.0, 999.0]

    asyncio.run(run())
