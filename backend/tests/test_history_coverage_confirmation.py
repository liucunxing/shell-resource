from types import SimpleNamespace

import pytest
from tests.test_reference_service import history_row

from app.core.history_policy import verified_history_coverage
from app.services.history_snapshot import history_snapshot
from app.services.reference_service import ReferenceService

DIGEST = "a" * 32


def confirmation(**changes):
    return {
        "sourceFingerprint": DIGEST, "year": 2026, "startMonth": 1,
        "actualThroughMonth": 9, "investmentThroughMonth": 9,
        "confirmedAt": "2026-11-15T00:00:00+00:00", **changes,
    }


@pytest.mark.parametrize("changes", [
    {"year": 2027}, {"startMonth": 7}, {"actualThroughMonth": 13},
    {"investmentThroughMonth": True}, {"confirmedAt": ""},
    {"sourceFingerprint": "b" * 32},
])
def test_invalid_or_other_batch_confirmation_does_not_verify(changes):
    assert verified_history_coverage(
        {"historyCoverageConfirmation": confirmation(**changes)}, DIGEST,
    ) is None


def test_verified_months_override_display_only_and_target_remains_missing():
    ref = {"historyCoverageConfirmation": confirmation()}
    coverage = verified_history_coverage(ref, DIGEST)
    manifest = history_snapshot(
        2027, [], ytd_cutoff_month=10, coverage=coverage,
        coverage_confirmation_status="verified",
    )["manifest"]
    assert manifest["actual"]["latestMonth"] == 9
    assert manifest["investment"]["latestMonth"] == 9
    assert manifest["configuredYtdCutoffMonth"] == 10
    assert manifest["effectiveYtdCutoffMonth"] == 9
    assert manifest["ytdYieldComparable"] is True
    assert manifest["missingFields"] == ["contractVolume"]
    assert manifest["sourcePeriodMetadataAvailable"] is False
    assert "actualBusinessMonth" in manifest["missingSourceFields"]


def test_expired_batch_has_unknown_effective_month_but_ordinary_demo_keeps_configuration():
    expired = history_snapshot(
        2027, [], ytd_cutoff_month=9, coverage_confirmation_status="expired",
    )["manifest"]
    assert expired["effectiveYtdCutoffMonth"] is None
    assert expired["actual"]["latestMonth"] is None
    assert expired["ytdYieldComparable"] is False
    assert "待确认" in expired["periods"][1]["label"]
    assert history_snapshot(2027, [], ytd_cutoff_month=10)["manifest"][
        "effectiveYtdCutoffMonth"
    ] == 10


@pytest.mark.asyncio
@pytest.mark.parametrize("digest,expense_month,expense,expected", [
    (DIGEST, 9, 17, 6 / 74),
    (DIGEST, 9, -17, 6 / 40),
    (DIGEST, 9, None, None),
    (DIGEST, 8, 17, None),
    ("b" * 32, 9, 17, None),
    (None, 9, 17, None),  # SQLite fixtures cannot inherit a real PG confirmation.
])
async def test_ytd_projection_requires_verified_same_period_and_complete_signed_total(
    digest, expense_month, expense, expected,
):
    row = {**history_row("Synthetic"), "mrd_2026": expense, "_source_fingerprint": digest}

    class Repository:
        async def list_dealers(self, *args, include_source_fingerprint=False):
            assert include_source_fingerprint is True
            return [row]

    class ConfigRepository:
        async def config(self):
            return SimpleNamespace(
                reference={"historyCoverageConfirmation": confirmation(
                    investmentThroughMonth=expense_month,
                )}, department_resources={}, role_resources={},
            )

    service = ReferenceService(object())
    service.repository = Repository()
    service.workspace_repository = ConfigRepository()
    history = (await service.get_dealers(2027))[0]["history"]
    assert history["yield2026Ytd"] == (None if expected is None else pytest.approx(expected))
    assert history["resources2026Ytd"] == {}
    assert service.coverage_confirmation_status == ("verified" if digest == DIGEST else "expired")
    if digest == DIGEST and expense_month == 9:
        assert history["ytdYieldUnavailableReason"] is None
    else:
        assert history["ytdYieldUnavailableReason"]
