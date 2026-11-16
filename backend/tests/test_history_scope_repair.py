import pytest
from scripts.repair_history_confirmation_scope import upgraded_confirmation

OLD = {
    "sourceFingerprint": "a" * 32,
    "year": 2026,
    "startMonth": 1,
    "actualThroughMonth": 9,
    "investmentThroughMonth": 9,
    "confirmedAt": "2026-11-15T06:00:07+00:00",
}


def test_repair_preserves_confirmation_without_mutating_input():
    result = upgraded_confirmation(OLD, "b" * 32, "b" * 32, "c" * 32)
    assert result == {
        **OLD,
        "sourceFingerprint": "c" * 32,
        "sourceFingerprintScope": "history_2026_v1",
    }
    assert OLD["sourceFingerprint"] == "a" * 32


@pytest.mark.parametrize(
    "existing,actual,expected",
    [
        (OLD, "b" * 32, "c" * 32),
        ({}, "b" * 32, "b" * 32),
        ({**OLD, "actualThroughMonth": None}, "b" * 32, "b" * 32),
        ({**OLD, "sourceFingerprintScope": "unknown"}, "b" * 32, "b" * 32),
        (OLD, "invalid", "b" * 32),
    ],
)
def test_repair_rejects_changed_data_or_missing_evidence(existing, actual, expected):
    with pytest.raises(ValueError):
        upgraded_confirmation(existing, actual, expected, "c" * 32)
