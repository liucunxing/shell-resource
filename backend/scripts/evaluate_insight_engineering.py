"""Real Qwen calls through the current service using a fresh synthetic SQLite fixture."""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "src")]


async def evaluate(args: argparse.Namespace) -> int:
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    os.environ["INSIGHT_LIVE"] = "1"
    os.environ["INSIGHT_FIXTURE_DIR"] = str(output / "database")
    from scripts import insight_local_fixture as fixture

    logging.getLogger("httpx").setLevel(logging.WARNING)
    from sqlalchemy import update

    from app.dependencies.workbench_user import WorkbenchUser
    from app.models.do import BudgetDO
    from app.models.do.distributor_history import distributor_sellin_resource_history as history
    from app.models.do.workspace import OtherBudgetDO
    from app.services.insight_pack_adapter import PACK_ROOT, InsightPack, build_evidence
    from app.services.insight_service import InsightService

    rows = []
    async with fixture.lifespan(None):
        for run, case in [(run, case) for run in range(1, args.repeat + 1) for case in args.cases]:
            async with fixture.factory() as session:
                await session.execute(
                    update(BudgetDO)
                    .where(BudgetDO.id == 1)
                    .values(plan_budget_amount=250000 if case == "overspend" else 300000)
                )
                await session.execute(
                    update(OtherBudgetDO).values(note="合成新经销商预留，用途明确")
                )
                for index, value in enumerate([6, 8, 12, 20, 10, 18], 1):
                    await session.execute(
                        history.update()
                        .where(history.c.distributor_code == f"SYN{index:03}")
                        .values(
                            yield_2025=value,
                            volume_2024=100 + index * 10,
                            volume_2025=95 + index * 12,
                            c3_2024=10000 + index * 1000,
                            c3_2025=9000 + index * 1400,
                        )
                    )
                if case == "healthy":
                    await session.execute(
                        history.update().values(
                            volume_2024=100, volume_2025=105, c3_2024=1000, c3_2025=1060
                        )
                    )
                elif case == "missing_note":
                    await session.execute(update(OtherBudgetDO).values(note=""))
                elif case == "zero_history":
                    await session.execute(
                        history.update().values(
                            volume_2024=0, volume_2025=100, c3_2024=0, c3_2025=1000
                        )
                    )
                elif case == "uniform_yield":
                    await session.execute(history.update().values(yield_2025=10))
                await session.commit()
                user = WorkbenchUser(
                    "insight-owner@example.test", "owner", "MKT", "合成验收", ("PCMO",)
                )
                for preset in args.presets:
                    entry = {"case": case, "preset": preset, "run": run, "calls": []}

                    class ObservedService(InsightService):
                        async def _call_model(self, body):
                            call = {
                                "request_bytes": len(
                                    json.dumps(body, ensure_ascii=False).encode("utf-8")
                                )
                            }
                            self.observed_entry["calls"].append(call)
                            started = time.perf_counter()
                            try:
                                result, usage = await super()._call_model(body)
                                call.update(result=result, usage=usage)
                                self.observed_entry["raw_result"] = result
                                return result, usage
                            except BaseException as exc:
                                call["error"] = type(exc).__name__
                                raise
                            finally:
                                call["elapsed_seconds"] = round(time.perf_counter() - started, 3)

                    service = ObservedService(session, user, fixture.settings)
                    service.observed_entry = entry
                    workspace = await service._workspace(2027)
                    descriptor = service._scope(workspace, "owner:" + user.email)
                    evidence = build_evidence(workspace, descriptor, user.role, 2027)
                    _, entry["metadata"] = InsightPack(PACK_ROOT).compile(
                        evidence, preset, fixture.settings.ai_model, False
                    )
                    entry["evidence"] = evidence
                    started = time.perf_counter()
                    try:
                        entry["record"] = await service.generate(
                            scope="owner:" + user.email, planning_year=2027, preset_id=preset
                        )
                        entry["status"] = "passed"
                    except Exception as exc:
                        cause = exc.__cause__ or exc
                        entry.update(
                            status="failed",
                            error=type(cause).__name__,
                            diagnostic=str(cause) if type(cause).__name__ == "PackError" else None,
                        )
                        response = getattr(cause, "response", None)
                        if response is not None:
                            entry["http_status"] = response.status_code
                            try:
                                diagnostic = response.json().get("error", {})
                                message = str(diagnostic.get("message", ""))[:1500]
                                entry["provider_message"] = message.replace(
                                    fixture.settings.ai_api_key.get_secret_value(), "[redacted]"
                                ).replace(fixture.settings.ai_base_url, "[endpoint]")
                            except (ValueError, AttributeError):
                                pass
                        await session.rollback()
                    entry["usage"] = {
                        key: sum(c.get("usage", {}).get(key, 0) for c in entry["calls"])
                        for key in ("prompt_tokens", "completion_tokens", "total_tokens")
                    }
                    entry["elapsed_seconds"] = round(time.perf_counter() - started, 2)
                    (output / f"{case}.{preset}.run{run}.json").write_text(
                        json.dumps(entry, ensure_ascii=False, indent=2), encoding="utf-8"
                    )
                    row = {
                        k: v
                        for k, v in entry.items()
                        if k not in {"raw_result", "record", "evidence", "calls"}
                    }
                    rows.append(row)
                    print(json.dumps(row, ensure_ascii=False), flush=True)
    summary = {
        "total": len(rows),
        "passed": sum(r["status"] == "passed" for r in rows),
        "total_tokens": sum(r.get("usage", {}).get("total_tokens", 0) for r in rows),
        "results": rows,
    }
    (output / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return 0 if summary["passed"] == summary["total"] else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--repeat", type=int, choices=range(1, 6), default=1)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--cases",
        nargs="+",
        choices=[
            "baseline",
            "healthy",
            "missing_note",
            "zero_history",
            "uniform_yield",
            "overspend",
        ],
        default=["baseline"],
    )
    parser.add_argument(
        "--presets",
        nargs="+",
        choices=["comprehensive", "quadrant", "structure"],
        default=["comprehensive"],
    )
    args = parser.parse_args()
    if not args.live:
        parser.error("--live is required; only synthetic fixtures are sent to the model")
    return asyncio.run(evaluate(args))


if __name__ == "__main__":
    raise SystemExit(main())
