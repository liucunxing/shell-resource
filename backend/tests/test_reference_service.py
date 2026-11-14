import asyncio

import pytest

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
        assert dealers[0]["history"]["yoyVol2425"] == 200
        assert dealers[0]["history"]["yoyC32425"] == 100
        assert dealers[0]["history"]["yield"] == pytest.approx(4 / 34)
        assert dealers[0]["history"]["yield2026Ytd"] is None
        assert dealers[0]["history"]["resources2026Ytd"] == {}
        assert dealers[0]["history"]["totalInvestment2025"] == 34
        assert dealers[0]["history"]["totalInvestment2026Ytd"] == 74
        assert dealers[0]["history"]["expenseAccess"]["source"] == "missing-department"

    asyncio.run(run())


@pytest.mark.parametrize(
    "changes, expected, reason",
    [
        ({"c3_2025": None}, None, "missing_inputs"),
        ({"mrd_2025": None}, None, "missing_inputs"),
        ({"c3_2025": 0}, None, "non_positive_inputs"),
        ({"c3_2025": -4}, None, "non_positive_inputs"),
        ({"mrd_2025": -27}, None, "non_positive_inputs"),
        ({"mrd_2025": -28}, None, "non_positive_inputs"),
        ({"mrd_2025": 0}, 4 / 27, None),
        ({"yield_2025": 9999}, 4 / 34, None),
    ],
)
def test_yield_uses_positive_c3_and_complete_positive_total(changes, expected, reason):
    async def run():
        original = {**history_row("Dealer"), **changes}
        before = dict(original)

        class Repository:
            async def list_dealers(self, *args):
                return [original]

        service = ReferenceService(None)
        service.repository = Repository()
        history = (await service.get_dealers(2027))[0]["history"]
        assert history["yield"] == (pytest.approx(expected) if expected is not None else None)
        assert history["yieldUnavailableReason"] == reason
        assert original == before
        assert history["resources2025"] == {}  # restricted details stay private

    asyncio.run(run())


@pytest.mark.parametrize("metric, key", [("volume", "yoyVol2425"), ("c3", "yoyC32425")])
@pytest.mark.parametrize(
    "base, current, expected, reason",
    [(0, 9, None, "no_base"), (-10, 9, None, "no_base"),
     (None, 9, None, "missing_base"), (10, None, None, "missing_current"),
     (10, 0, -100, None), (10, -5, -150, None), (10, 12.5, 25, None)],
)
def test_yoy_uses_raw_metrics_and_identifies_missing_baseline(
    metric, key, base, current, expected, reason,
):
    async def run():
        original = {**history_row("Dealer"), f"{metric}_2024": base, f"{metric}_2025": current}
        before = dict(original)

        class Repository:
            async def list_dealers(self, *args):
                return [original]

        service = ReferenceService(None)
        service.repository = Repository()
        history = (await service.get_dealers(2027))[0]["history"]
        assert history[key] == expected
        assert history[key + "UnavailableReason"] == reason
        assert original == before

    asyncio.run(run())
