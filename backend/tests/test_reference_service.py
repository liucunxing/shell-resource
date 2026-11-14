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
        "mrd_2026": 17,
        "reb_2026": 18,
        "btl_2026": 19,
        "capex_2026": 20,
        "yield_2025": 11,
        "yield_2026": 21,
        "sd": "SD East",
        "rsm": "RSM 01",
        "distributor_status": 1,
        "yoy_vol_24_25": 0.125,
        "yoy_c3_24_25": -0.0325,
        "sector": "PCMO",
    }


class DuplicateReferenceRepository:
    async def list_dealers(self, dealer_ids=None, sectors=None):
        del dealer_ids, sectors
        return [
            history_row("Duplicate Dealer"),
            {**history_row("Duplicate Dealer Alias"), "rsm": "RSM 02"},
            {**history_row("Duplicate Dealer"), "sector": "CRTO", "volume_2025": 999},
        ]


def test_reference_results_preserve_sectors_for_the_same_distributor_code():
    async def run():
        service = ReferenceService(None)
        service.repository = DuplicateReferenceRepository()

        dealers = await service.get_dealers(2027)
        assert [(item["code"], item["sector"]) for item in dealers] == [
            ("D-DUPLICATE", "PCMO"),
            ("D-DUPLICATE", "PCMO"),
            ("D-DUPLICATE", "CRTO"),
        ]
        assert len({item["id"] for item in dealers}) == 3
        assert [item["history"]["vol2025"] for item in dealers] == [3.0, 3.0, 999.0]
        assert dealers[0]["sd"] == "SD East"
        assert dealers[0]["rsm"] == "RSM 01"
        assert dealers[0]["status"] == "active"
        assert dealers[0]["history"]["yoyVol2425"] == 12.5
        assert dealers[0]["history"]["yoyC32425"] == -3.25
        assert dealers[0]["history"]["yield2026Ytd"] == 21.0
        assert dealers[0]["history"]["resources2026Ytd"] == {
            "MRD": 17.0,
            "SP&A": 19.0,
            "ICE Rebate": 18.0,
            "Capex": 20.0,
        }

    asyncio.run(run())
