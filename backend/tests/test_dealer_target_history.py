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
@pytest.mark.parametrize("source,expected", [
    (0, 0), (1.17, 1.17), (None, None), (float("inf"), None),
])
async def test_vol_phasing_uses_source_without_target_or_period_confirmation(source, expected):
    _, records = await project(
        {"phasing_2025": source, "phasing_2026": source,
         "target_2025": None, "target_2026": None},
        actual=False, confirmed=False,
    )
    history = records[0]["history"]
    assert history["phasing2025"] == expected
    assert history["phasing2026Ytd"] == expected


@pytest.mark.asyncio
@pytest.mark.parametrize("unit", ["L", "KL"])
async def test_target_projection_uses_fixed_source_l_despite_legacy_unit_metadata(unit):
    service, records = await project(target_changes={"sourceUnit": unit})
    h = records[0]["history"]
    assert h["phasing2025"] == 999
    assert h["phasing2026Ytd"] == 999
    assert h["contract2025"] == 20
    assert h["contract2026Ytd"] == 30
    assert h["sourceTarget2026Ytd"] == 30
    assert h["target2026YtdUnavailableReason"] is None
    manifest = history_snapshot(
        2027, records, coverage=service.coverage,
        target_coverage=service.target_coverage,
        target_confirmation_status=service.target_confirmation_status,
    )["manifest"]
    assert manifest["target"]["sourceFieldsPresent"] is True
    assert manifest["metricRules"]["phasing"]["sourcePhasingUsed"] is True
    assert manifest["target"]["periods"]["2025"]["sourcePhasingField"] == "phasing_2025"
    assert "contractVolume" not in manifest["missingFields"]


@pytest.mark.asyncio
@pytest.mark.parametrize("amount", [None, 0, -5])
async def test_missing_zero_and_negative_targets_remain_distinct(amount):
    _, records = await project({"target_2026": amount})
    h = records[0]["history"]
    assert h["sourceTarget2026Ytd"] == amount
    assert h["contract2026Ytd"] == amount


@pytest.mark.asyncio
@pytest.mark.parametrize("unit", ["L", "KL"])
async def test_signed_targets_remain_distinct_from_missing_in_fixed_source_l(unit):
    _, records = await project(
        {"target_2025": -20, "target_2026": -30}, {"sourceUnit": unit},
    )
    h = records[0]["history"]
    assert h["sourceTarget2025"] == -20
    assert h["sourceTarget2026Ytd"] == -30
    assert h["contract2025"] == -20
    assert h["contract2026Ytd"] == -30


@pytest.mark.asyncio
@pytest.mark.parametrize("confirmed,fingerprint", [(False, DIGEST), (True, "b" * 32)])
async def test_signed_source_target_remains_visible_when_confirmation_expires(
    confirmed, fingerprint,
):
    _, records = await project(
        {"target_2025": -20, "target_2026": -30, "_source_fingerprint": fingerprint},
        confirmed=confirmed,
    )
    h = records[0]["history"]
    assert h["sourceTarget2025"] == -20
    assert h["sourceTarget2026Ytd"] == -30
    assert h["contract2025"] == -20
    assert h["contract2026Ytd"] == -30


@pytest.mark.asyncio
async def test_new_source_or_missing_confirmation_does_not_hide_target_values():
    for kwargs in [
        {"row_changes": {"_source_fingerprint": "b" * 32}},
        {"confirmed": False},
    ]:
        service, records = await project(**kwargs)
        h = records[0]["history"]
        assert h["sourceTarget2025"] == 20
        assert h["contract2025"] == 20
        assert h["contract2026Ytd"] == 30
        assert h["target2026YtdUnavailableReason"] is None
        assert h["targetSourceUnit"] == "L"
        manifest = history_snapshot(
            2027, records, target_confirmation_status=service.target_confirmation_status,
        )["manifest"]
        assert manifest["target"]["available"] is True
        assert manifest["target"]["sourceUnit"] == "L"
        assert "targetUnit" not in manifest["missingFields"]


@pytest.mark.asyncio
async def test_ytd_target_value_is_independent_of_actual_period_metadata():
    for kwargs in [
        {"actual": False},
        {"target_changes": {"periods": {"2025": {"startMonth": 1, "endMonth": 12},
                                         "2026": {"startMonth": 1, "endMonth": 12}}}},
    ]:
        _, records = await project(**kwargs)
        h = records[0]["history"]
        assert h["contract2025"] == 20
        assert h["contract2026Ytd"] == 30
        assert h["target2026YtdUnavailableReason"] is None


@pytest.mark.asyncio
async def test_missing_or_zero_actual_does_not_override_target():
    for actual in (None, 0, -3):
        _, records = await project({"volume_2026": actual})
        h = records[0]["history"]
        assert h["contract2026Ytd"] == 30


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
    assert "phasing_2025" in sql
    assert "phasing_2026" in sql
    assert "distributor_sellin_resource_history.target_2025" not in sql
    if dialect.name == "postgresql":
        assert "row_to_json(distributor_sellin_resource_history)" in sql
        assert "->> 'target_2025'" in sql
        assert "jsonb_exists" in sql
    else:
        assert "NULL AS target_2025" in sql
        assert "row_to_json" not in sql


@pytest.mark.asyncio
@pytest.mark.parametrize("amount,reason", [(None, "missing_target"),
    (float("nan"), "invalid_target"), (float("inf"), "invalid_target")])
async def test_direct_target_missing_and_nonfinite_values_remain_json_safe(amount, reason):
    import json

    _, records = await project({"target_2025": amount, "target_2026": amount}, confirmed=False)
    h = records[0]["history"]
    for suffix in ("2025", "2026Ytd"):
        assert h[f"sourceTarget{suffix}"] is None
        assert h[f"contract{suffix}"] is None
        assert h[f"target{suffix}UnavailableReason"] == reason
    json.dumps(records, allow_nan=False)


@pytest.mark.asyncio
async def test_zero_target_is_available_numeric_data_in_manifest():
    _, records = await project({"target_2025": 0, "target_2026": 0}, confirmed=False)
    manifest = history_snapshot(2027, records)["manifest"]
    assert manifest["target"]["available"] is True
    for suffix in ("2025", "2026Ytd"):
        assert manifest["target"]["periods"][suffix]["availableRecordCount"] == 1
        assert manifest["target"]["periods"][suffix]["positiveTargetCount"] == 0
