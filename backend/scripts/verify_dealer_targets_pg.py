"""Read-only reconciliation of optional dealer target fields against the live source.

No business rows, identities or connection strings are written to the report.
This checks the real PG projection and independent period metadata, not a demo fixture.
"""

import argparse
import asyncio
import json
import sys
from math import isfinite
from pathlib import Path
from types import SimpleNamespace

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from app.core.config import get_settings  # noqa: E402
from app.services.reference_service import ReferenceService  # noqa: E402


async def verify() -> dict:
    engine = create_async_engine(
        get_settings().database_url.get_secret_value(), hide_parameters=True,
        isolation_level="REPEATABLE READ",
        connect_args={"timeout": 15, "server_settings": {
            "default_transaction_read_only": "on", "statement_timeout": "30000",
            "application_name": "resource_target_readonly_reconciliation",
        }},
    )
    try:
        async with AsyncSession(engine) as session:
            rows = (await session.execute(text(
                "SELECT sector,distributor_code,volume_2025,volume_2026,"
                "target_2025,target_2026,phasing_2025,phasing_2026 "
                "FROM data.distributor_sellin_resource_history"
            ))).mappings().all()
            service = ReferenceService(session)
            records = await service.get_dealers(2027)
            by_key = {(record["sector"], record["code"]): record for record in records}
            assert len(rows) == len(records) == len(by_key), "Source identity/count mismatch"
            report = {
                "mode": "read_only", "rows": len(rows),
                "historyCoverageStatus": service.coverage_confirmation_status,
                "targetConfirmationStatus": service.target_confirmation_status,
                "years": {},
            }
            for year, suffix in ((2025, "2025"), (2026, "2026Ytd")):
                counts = dict(positive=0, zero=0, missing=0, negative=0,
                              sourcePhasing=0, sourceRatioMatches=0, apiTarget=0,
                              apiPositiveTarget=0, apiPhasing=0, gated=0)
                for row in rows:
                    target, volume, source_ratio = (
                        row[f"target_{year}"], row[f"volume_{year}"], row[f"phasing_{year}"]
                    )
                    history = by_key[(row["sector"], row["distributor_code"])]["history"]
                    state = ("missing" if target is None else "positive" if target > 0
                             else "negative" if target < 0 else "zero")
                    counts[state] += 1
                    for source, field in (
                        (target, f"sourceTarget{suffix}"),
                        (source_ratio, f"sourcePhasing{suffix}"),
                    ):
                        actual = history.get(field)
                        expected_source = float(source) if source is not None else None
                        if expected_source is not None:
                            expected_source = expected_source if isfinite(expected_source) else None
                        assert actual == expected_source, (
                            f"Raw source projection mismatch: {field}"
                        )
                    expected_ratio = float(source_ratio) if source_ratio is not None else None
                    if expected_ratio is not None and not isfinite(expected_ratio):
                        expected_ratio = None
                    assert history[f"phasing{suffix}"] == expected_ratio, "Source Phasing mismatch"
                    counts["apiPhasing"] += int(expected_ratio is not None)
                    if expected_ratio is not None:
                        counts["sourcePhasing"] += 1
                        if target is not None and target > 0 and volume is not None:
                            if abs(float(source_ratio) - float(volume / target)) <= 0.00500001:
                                counts["sourceRatioMatches"] += 1
                    normalized = history.get(f"contract{suffix}")
                    if normalized is not None:
                        counts["apiTarget"] += 1
                        counts["apiPositiveTarget"] += int(normalized > 0)
                        assert target is not None, "Missing target became an API value"
                        assert normalized == float(target), "Fixed-L source target mismatch"
                    elif target is not None and isfinite(float(target)):
                        raise AssertionError("Finite source target was hidden")
                report["years"][str(year)] = counts
            # Exercise confirmed/unconfirmed unit/period branches entirely in
            # Python memory. This is test input, never business confirmation.
            config = await service.workspace_repository.config()
            digest = await session.scalar(service.repository.fingerprint_statement())
            # These are isolated test assumptions when live coverage has expired,
            # never persisted and never reported as current business coverage.
            actual_month = service.coverage["actualThroughMonth"] if service.coverage else 9
            other_month = 12 if actual_month != 12 else 11
            scenarios = []
            for unit, month in (("L", actual_month), ("KL", actual_month), ("L", other_month)):
                override = SimpleNamespace(
                    reference={**(config.reference or {}), "historyCoverageConfirmation": {
                        "sourceFingerprint": digest, "year": 2026, "startMonth": 1,
                        "actualThroughMonth": actual_month, "investmentThroughMonth": actual_month,
                        "confirmedAt": "2026-11-15T00:00:00+00:00",
                    }, "dealerTargetConfirmation": {
                        "sourceFingerprint": digest, "sourceUnit": unit,
                        "periods": {"2025": {"startMonth": 1, "endMonth": 12},
                                    "2026": {"startMonth": 1, "endMonth": month}},
                        "confirmedAt": "2026-11-15T00:00:00+00:00",
                    }},
                    department_resources=config.department_resources,
                    role_resources=config.role_resources,
                )

                class MemoryConfig:
                    def __init__(self, value):
                        self.value = value

                    async def config(self):
                        return self.value

                probe = ReferenceService(session)
                probe.workspace_repository = MemoryConfig(override)
                projected = {(r["sector"], r["code"]): r["history"]
                             for r in await probe.get_dealers(2027)}
                eligible = {"2025": 0, "2026Ytd": 0}
                for row in rows:
                    history = projected[(row["sector"], row["distributor_code"])]
                    for year, suffix in ((2025, "2025"), (2026, "2026Ytd")):
                        raw = row[f"target_{year}"]
                        expected = float(raw) if raw is not None else None
                        expected = expected if expected is None or isfinite(expected) else None
                        assert history[f"contract{suffix}"] == expected
                        source_ratio = row[f"phasing_{year}"]
                        ratio = float(source_ratio) if source_ratio is not None else None
                        ratio = ratio if ratio is None or isfinite(ratio) else None
                        assert history[f"phasing{suffix}"] == ratio, (
                            "Source Phasing changed by target gate"
                        )
                        eligible[suffix] += int(ratio is not None)
                scenarios.append({"sourceUnit": unit, "target2026ThroughMonth": month,
                                  "eligible": eligible, "passed": True})
            report["inMemoryTestScenariosNotBusinessConfirmation"] = scenarios
            return report
    finally:
        await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    result = asyncio.run(verify())
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
