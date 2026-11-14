from app.services.history_snapshot import HISTORY_SOURCE, history_snapshot


def test_snapshot_does_not_invent_business_months_or_targets():
    records = [{"id": "one", "history": {"vol2025": 0, "vol2026Ytd": 12}}]
    snapshot = history_snapshot(2027, records)
    manifest = snapshot["manifest"]
    assert snapshot["records"] is records
    assert manifest["availableYears"] == [2025, 2026]
    assert manifest["actual"]["latestMonth"] is None
    assert manifest["investment"]["latestMonth"] is None
    assert manifest["source"] == HISTORY_SOURCE
    assert manifest["ytdYieldComparable"] is False
    assert {"contractVolume", "ppp"}.issubset(manifest["missingFields"])


def test_new_planning_year_never_relabels_existing_values():
    snapshot = history_snapshot(2028, [{"id": "one", "history": {"vol2026Ytd": 12}}])
    assert snapshot["manifest"]["fullYear"] == 2025
    assert snapshot["manifest"]["ytdYear"] == 2026
    assert snapshot["manifest"]["missingExpectedYears"] == [2027]
    assert snapshot["records"][0]["history"] == {"vol2026Ytd": 12}


def test_missing_data_is_not_zero_and_count_uses_authorized_records():
    snapshot = history_snapshot(2027, [{"id": "one", "history": {"vol2025": None}}])
    assert snapshot["manifest"]["availableYears"] == []
    assert snapshot["manifest"]["count"] == 1
    assert snapshot["manifest"]["missingExpectedYears"] == [2025, 2026]
    assert history_snapshot(2027, [])["records"] == []
