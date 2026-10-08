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
        "resource_total": 34,
        "resource_uc3": 12,
    }


class DuplicateReferenceRepository:
    async def list_dealers(self, dealer_ids=None):
        del dealer_ids
        return [history_row("Duplicate Dealer"), history_row("Duplicate Dealer Alias")]

    async def list_directory(self):
        return [
            history_row("Duplicate Dealer"),
            history_row("Duplicate Dealer Alias"),
        ]


def test_reference_results_are_unique_by_distributor_code():
    async def run():
        service = ReferenceService(None)
        service.repository = DuplicateReferenceRepository()

        dealers = await service.get_dealers(2027)
        directory = await service.get_directory()

        assert [item["id"] for item in dealers] == ["D-DUPLICATE"]
        assert [item["id"] for item in directory] == ["D-DUPLICATE"]

    asyncio.run(run())
