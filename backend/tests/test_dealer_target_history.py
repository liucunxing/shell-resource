from types import SimpleNamespace

import pytest
from sqlalchemy.dialects import postgresql, sqlite
from tests.test_history_coverage_confirmation import DIGEST, confirmation
from tests.test_reference_service import history_row

from app.core.history_policy import verified_dealer_target_coverage
from app.repositories.reference_repository import ReferenceRepository
from app.services.history_snapshot import history_snapshot
from app.services.reference_service import ReferenceService


def target_confirmation(**changes):
    return {
        "sourceFingerprint": DIGEST, "sourceUnit": "L",
        "periods": {"2025": {"startMonth": 1, "endMonth": 12},
                    "2026": {"startMonth": 1, "endMonth": 9}},
        "confirmedAt": "2026-11-15T00:00:00+00:00", **changes,
    }


@pytest.mark.parametrize("changes", [
    {"sourceUnit": "litres"}, {"sourceUnit": None}, {"sourceFingerprint": "b" * 32},
    {"confirmedAt": "yesterday"}, {"confirmedAt": "2026-11-15"},
    {"periods": {"2025": {"startMonth": 1, "endMonth": 9},
                 "2026": {"startMonth": 1, "endMonth": 9}}},
    {"periods": {"2025": {"startMonth": 1, "endMonth": 12},
                 "2026": {"startMonth": True, "endMonth": 9}}},
    {"periods": {"2025": {"startMonth": 1, "endMonth": 12},
                 "2026": {"startMonth": 1, "endMonth": 13}}},
    {"periods": {"2025": {"startMonth": 1, "endMonth": 12}}},
])
def test_invalid_target_confirmation_is_not_coverage(changes):
    assert verified_dealer_target_coverage(
        {"dealerTargetConfirmation": target_confirmation(**changes)}, DIGEST,
    ) is None


async def project(row_changes=None, target_changes=None, *, actual=True, confirmed=True):
    source = {**history_row("Synthetic target"), "_source_fingerprint": DIGEST,
              "target_2025": 20, "target_2026": 30, "phasing_2025": 999,
              "phasing_2026": 999, "_has_target_2025": True, "_has_target_2026": True,
              **(row_changes or {})}
    ref = {"historyCoverageConfirmation": confirmation()} if actual else {}
    if confirmed:
        ref["dealerTargetConfirmation"] = target_confirmation(**(target_changes or {}))

    class Repository:
        async def list_dealers(self, *args, **kwargs):
            return [source]

    class ConfigRepository:
        async def config(self):
            return SimpleNamespace(reference=ref, department_resources={}, role_resources={})

    service = ReferenceService(object())
    service.repository = Repository()
    service.workspace_repository = ConfigRepository()
    records = await service.get_dealers(2027)
    return service, records


@pytest.mark.asyncio
@pytest.mark.parametrize("unit,multiplier", [("L", 1), ("KL", 1000)])
async def test_target_projection_normalizes_units_but_keeps_source_phasing(unit, multiplier):
    service, records = await project(target_changes={"sourceUnit": unit})
    h = records[0]["history"]
    assert h["contract2025"] == 20 * multiplier
    assert h["contract2026Ytd"] == 30 * multiplier
    assert h["sourceTarget2026Ytd"] == 30
    assert h["sourcePhasing2026Ytd"] == 999
    assert h["phasing2026Ytd"] == 999
    assert h["phasing2025"] == 999
    assert h["target2026YtdUnavailableReason"] is None
    manifest = history_snapshot(
        2027, records, coverage=service.coverage,
        target_coverage=service.target_coverage,
        target_confirmation_status=service.target_confirmation_status,
    )["manifest"]
    assert manifest["target"]["sourceFieldsPresent"] is True
    assert manifest["metricRules"]["phasing"]["availableRecordCounts"] == {
        "2025": 1, "2026Ytd": 1,
    }
    assert manifest["metricRules"]["phasing"]["sourcePhasingUsed"] is True
    assert "contractVolume" not in manifest["missingFields"]


@pytest.mark.asyncio
@pytest.mark.parametrize("amount", [None, 0, -5])
async def test_missing_zero_and_negative_targets_do_not_mask_source_phasing(amount):
    _, records = await project({"target_2026": amount})
    h = records[0]["history"]
    assert h["sourceTarget2026Ytd"] == amount
    assert h["contract2026Ytd"] == amount
    assert h["phasing2026Ytd"] == 999
    assert h["phasing2026YtdUnavailableReason"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("unit,multiplier", [("L", 1), ("KL", 1000)])
async def test_signed_targets_remain_distinct_from_missing_after_normalization(unit, multiplier):
    _, records = await project(
        {"target_2025": -20, "target_2026": -30}, {"sourceUnit": unit},
    )
    h = records[0]["history"]
    assert h["sourceTarget2025"] == -20
    assert h["sourceTarget2026Ytd"] == -30
    assert h["contract2025"] == -20 * multiplier
    assert h["contract2026Ytd"] == -30 * multiplier
    assert h["phasing2025"] == 999
    assert h["phasing2026Ytd"] == 999
    assert h["phasing2025UnavailableReason"] is None
    assert h["phasing2026YtdUnavailableReason"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("confirmed,fingerprint", [(False, DIGEST), (True, "b" * 32)])
async def test_signed_source_target_cannot_bypass_confirmation_gates(confirmed, fingerprint):
    _, records = await project(
        {"target_2025": -20, "target_2026": -30, "_source_fingerprint": fingerprint},
        confirmed=confirmed,
    )
    h = records[0]["history"]
    assert h["sourceTarget2025"] == -20
    assert h["sourceTarget2026Ytd"] == -30
    assert h["contract2025"] is None
    assert h["contract2026Ytd"] is None
    assert h["phasing2025"] == 999
    assert h["phasing2026Ytd"] == 999


@pytest.mark.asyncio
async def test_new_source_or_missing_confirmation_blocks_target_but_exposes_source_values():
    for kwargs, reason in [
        ({"row_changes": {"_source_fingerprint": "b" * 32}}, "target_confirmation_expired"),
        ({"confirmed": False}, "target_unit_period_unconfirmed"),
    ]:
        service, records = await project(**kwargs)
        h = records[0]["history"]
        assert h["sourceTarget2025"] == 20
        assert h["contract2025"] is None
        assert h["contract2026Ytd"] is None
        assert h["target2026YtdUnavailableReason"] == reason
        manifest = history_snapshot(
            2027, records, target_confirmation_status=service.target_confirmation_status,
        )["manifest"]
        assert manifest["target"]["available"] is False
        assert manifest["metricRules"]["phasing"]["available"] is True
        assert manifest["metricRules"]["phasing"]["unavailableReason"] is None
        assert "targetUnit" in manifest["missingFields"]


@pytest.mark.asyncio
async def test_ytd_target_requires_actual_period_and_exact_match_without_blocking_2025():
    for kwargs, reason in [
        ({"actual": False}, "actual_period_unconfirmed"),
        ({"target_changes": {"periods": {"2025": {"startMonth": 1, "endMonth": 12},
                                          "2026": {"startMonth": 1, "endMonth": 12}}}},
         "target_actual_period_mismatch"),
    ]:
        _, records = await project(**kwargs)
        h = records[0]["history"]
        assert h["contract2025"] == 20
        assert h["contract2026Ytd"] is None
        assert h["target2026YtdUnavailableReason"] == reason


@pytest.mark.asyncio
async def test_missing_or_zero_actual_does_not_override_source_phasing():
    for actual in (None, 0, -3):
        _, records = await project({"volume_2026": actual})
        h = records[0]["history"]
        assert h["contract2026Ytd"] == 30
        assert h["phasing2026Ytd"] == 999


@pytest.mark.asyncio
@pytest.mark.parametrize("dialect", [postgresql.dialect(), sqlite.dialect()])
async def test_optional_source_projection_does_not_require_physical_target_columns(dialect):
    class Session:
        statement = None

        def get_bind(self):
            return SimpleNamespace(dialect=dialect)

        async def execute(self, statement):
            self.statement = statement
            return SimpleNamespace(mappings=lambda: SimpleNamespace(all=lambda: []))

    session = Session()
    assert await ReferenceRepository(session).list_dealers() == []
    sql = str(session.statement.compile(dialect=dialect, compile_kwargs={"literal_binds": True}))
    assert "distributor_sellin_resource_history.target_2025" not in sql
    if dialect.name == "postgresql":
        assert "row_to_json(distributor_sellin_resource_history)" in sql
        assert "->> 'target_2025'" in sql
        assert "jsonb_exists" in sql
    else:
        assert "NULL AS target_2025" in sql
        assert "row_to_json" not in sql


@pytest.mark.asyncio
@pytest.mark.parametrize("source,expected,reason", [
    (None, None, "missing_source_phasing"), (0, 0, None), (1, 1, None),
    (1.17, 1.17, None), (-0.25, -0.25, None),
    (float("nan"), None, "invalid_source_phasing"),
    (float("inf"), None, "invalid_source_phasing"),
    (float("-inf"), None, "invalid_source_phasing"),
])
async def test_source_phasing_is_authoritative_and_json_safe_without_confirmation(
    source, expected, reason,
):
    import json

    _, records = await project(
        {"phasing_2025": source, "phasing_2026": source}, actual=False, confirmed=False,
    )
    h = records[0]["history"]
    for suffix in ("2025", "2026Ytd"):
        assert h[f"phasing{suffix}"] == expected
        assert h[f"sourcePhasing{suffix}"] == expected
        assert h[f"phasing{suffix}UnavailableReason"] == reason
    json.dumps(records, allow_nan=False)
    manifest = history_snapshot(2027, records)["manifest"]
    assert manifest["metricRules"]["phasing"]["available"] is (expected is not None)
    assert manifest["metricRules"]["phasing"]["sourcePhasingUsed"] is True


@pytest.mark.asyncio
async def test_source_phasing_preserves_same_code_distinct_sector_values():
    _, crto = await project({"sector": "CRTO", "phasing_2025": 1.00})
    _, pcmo = await project({"sector": "PCMO", "phasing_2025": 1.17})
    assert crto[0]["id"] != pcmo[0]["id"]
    assert crto[0]["history"]["phasing2025"] == 1.00
    assert pcmo[0]["history"]["phasing2025"] == 1.17
