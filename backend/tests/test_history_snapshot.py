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


def test_configured_month_does_not_create_actual_coverage_or_enable_ytd_yield():
    default = history_snapshot(2027, [])["manifest"]
    assert default["configuredYtdCutoffMonth"] == 10
    for month in (1, 9, 12):
        manifest = history_snapshot(2027, [], ytd_cutoff_month=month)["manifest"]
        assert manifest["configuredYtdCutoffMonth"] == month
        assert manifest["configuredPeriodLabel"] == f"2026 YTD（1–{month}月）"
        assert manifest["configuredMonthIsCoverageEvidence"] is False
        assert manifest["actual"]["latestMonth"] is None
        assert manifest["investment"]["latestMonth"] is None
        assert manifest["ytdYieldComparable"] is False


def test_manifest_declares_units_and_unavailable_metrics_without_substitution():
    manifest = history_snapshot(2027, [])["manifest"]
    assert manifest["units"]["api"] == {"volume": "L", "c3": "USD", "investment": "CNY"}
    assert manifest["units"]["display"] == {"volume": "KL", "c3": "K$", "investment": "千元人民币"}
    assert manifest["units"]["displayDivisor"] == 1000
    rules = manifest["metricRules"]
    assert rules["yield"]["sourceYieldUsed"] is False
    assert rules["yield"]["unit"] == "USD/CNY"
    assert rules["yield"]["fxConverted"] is False
    assert rules["yield"]["displaySuffix"] == ""
    assert rules["yoy"]["nonPositiveBaseReason"] == "no_base"
    assert rules["phasing"]["available"] is False
    assert rules["phasing"]["unavailableReason"] == "missing_contract_volume"
    assert rules["phasing"]["trafficLight"]["relativeYellowBand"] == 0.1
    assert rules["phasing"]["contractPeriod"] == "full_year_signed"
    assert rules["ppp"]["defined"] is True
    assert rules["ppp"]["kind"] == "target"
    assert rules["ppp"]["metrics"] == ["volume", "c3"]
    assert rules["ppp"]["displayUnits"] == {"volume": "KL", "c3": "K$"}
    assert rules["ppp"]["available"] is False
    assert rules["ppp"]["unavailableReason"] == "missing_target_data"
