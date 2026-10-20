"""Opt-in real-model acceptance using a fresh, synthetic SQLite workspace only."""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
from pathlib import Path
from time import perf_counter

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "src")]


async def evaluate(args: argparse.Namespace) -> int:
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    os.environ["INSIGHT_FIXTURE_DIR"] = str(output / "database")
    os.environ["INSIGHT_LIVE"] = "1" if args.live else "0"
    import httpx
    from scripts import insight_local_fixture as fixture
    from sqlalchemy import delete, update

    from app.models.do import BudgetDO
    from app.models.do.budget_distributor import BudgetDistributorDO
    from app.models.do.distributor_history import distributor_sellin_resource_history as history
    from app.models.do.workspace import OtherBudgetDO, WorkspaceConfigDO
    from app.services.insight_pack_adapter import PACK_ROOT, InsightPack, build_evidence
    from app.services.insight_service import InsightService

    # Capture synthetic candidates only in this opt-in local harness. Production
    # logging never stores model responses or business input.
    original_call = InsightService._call_model
    candidates = []

    async def capture_candidate(service, body):
        result, usage = await original_call(service, body)
        candidates.append({"result": result, "usage": usage})
        (output / "synthetic-candidates.json").write_text(
            json.dumps(candidates, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return result, usage

    InsightService._call_model = capture_candidate

    logging.getLogger("httpx").setLevel(logging.WARNING)
    assert fixture.engine.dialect.name == "sqlite", "Acceptance must never mutate a remote database"
    if args.live and not fixture.settings.ai_api_key.get_secret_value():
        raise RuntimeError("Live acceptance requires the configured development model key")
    results = []
    async with fixture.lifespan(None):
        async with fixture.factory() as session:
            await session.execute(
                delete(BudgetDistributorDO).where(BudgetDistributorDO.budget_id == 1)
            )
            await session.execute(delete(OtherBudgetDO).where(OtherBudgetDO.budget_id == 1))
            await session.execute(history.delete())
            total = 0
            for index in range(1, args.dealers + 1):
                code = f"SYN{index:03d}"
                plan = 100000 + index % 7 * 1000
                actual = 100000
                if index == 1:
                    plan = 1000000
                elif index == 2:
                    plan, actual = 0, 120000
                elif index == 3:
                    plan, actual = 70000, 0
                elif index == 4:
                    plan = 30000
                elif index == 5:
                    actual = None
                elif index == args.dealers:
                    plan = 1200000
                await session.execute(
                    history.insert().values(
                        distributor_code=code,
                        distributor_name=f"合成经销商 {index}",
                        sector="PCMO",
                        volume_2024=700 + index,
                        volume_2025=800 + index,
                        c3_2024=100000 + index * 100,
                        c3_2025=110000 + index * 120,
                        volume_2026=400 + index,
                        c3_2026=60000 + index * 50,
                        mrd_2025=actual,
                        btl_2025=7000,
                        reb_2025=9000,
                        capex_2025=8000,
                        yield_2025=2 + (index % 21) / 10,
                    )
                )
                # SYN002 intentionally has historical actual but no allocation row.
                if index != 2:
                    session.add(
                        BudgetDistributorDO(
                            budget_id=1,
                            planning_year=2027,
                            sector="PCMO",
                            department="MKT",
                            resource_type="MRD",
                            initiative_name="Insight 合成验收 1",
                            distributor_code=code,
                            distributor_budget_amount=plan,
                            input_source="SYNTHETIC_INSIGHT",
                        )
                    )
                    total += plan
            await session.execute(
                update(BudgetDO)
                .where(BudgetDO.id == 1)
                .values(plan_budget_amount=total, allocate_budget_amount=total)
            )
            await session.execute(
                update(WorkspaceConfigDO).values(
                    guide={
                        "version": 10,
                        "text": "合成验收数据，历史2025实际与2027计划为跨年参考。",
                    }
                )
            )
            await session.commit()
        headers = {"X-User-Email": "insight-owner@example.test"}
        scope = "owner:insight-owner@example.test"
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=fixture.app),
            base_url="http://synthetic.test",
            headers=headers,
            timeout=70,
        ) as client:
            workspace_response = await client.get("/api/v1/workbench/workspace?planning_year=2027")
            workspace_response.raise_for_status()
            workspace = workspace_response.json()["data"]
            descriptor = {"scope": scope, "items": workspace["state"]["initiatives"]}
            evidence = build_evidence(workspace, descriptor, "owner", 2027)
            (output / "synthetic-evidence.json").write_text(
                json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            comparison = next(d for d in evidence["datasets"] if d["id"] == "investment-review")
            rows = {r["dealer_id"]: r for r in comparison["rows"]}
            assert len(rows) == args.dealers
            assert rows["SYN001"]["multiple"] == 10 and rows["SYN001"]["status"] == "review"
            assert rows["SYN002"]["reason_code"] == "unallocated"
            assert rows["SYN003"]["historical_actual"] == 0
            assert rows["SYN005"]["historical_actual"] is None
            for preset in args.presets:
                body, metadata = InsightPack(PACK_ROOT).compile(
                    evidence, preset, fixture.settings.ai_model, False
                )
                entry = {
                    "preset": preset,
                    "dealers": args.dealers,
                    "request_bytes": len(
                        httpx.Request(
                            "POST",
                            "http://synthetic.test",
                            json={
                                **body,
                                "stream": True,
                                "stream_options": {"include_usage": True},
                            },
                        ).content
                    ),
                    "model": fixture.settings.ai_model,
                    "metadata": metadata,
                    "live": args.live,
                }
                if args.live:
                    started = perf_counter()
                    response = await client.post(
                        "/api/v1/workbench/insights/generate",
                        json={"scope": scope, "planning_year": 2027, "preset_id": preset},
                    )
                    entry.update(
                        status=response.status_code, seconds=round(perf_counter() - started, 3)
                    )
                    if response.status_code == 200:
                        record = response.json()["data"]
                        (output / f"{preset}-record.json").write_text(
                            json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8"
                        )
                        entry["timing"] = record["metadata"]["timing"]
                        entry["attempts"] = record["metadata"]["attempts"]
                        entry["usage"] = record["metadata"]["usage"]
                        entry["headline"] = record["result"]["headline"]
                        entry["summary"] = record["result"]["summary"]
                        trend = next(
                            c for c in record["result"]["checks"] if c["dimension_id"] == "trend"
                        )
                        assert trend["status"] == "review"
                        stored_rows = next(
                            d
                            for d in record["evidence"]["datasets"]
                            if d["id"] == "investment-review"
                        )["rows"]
                        assert len(stored_rows) == args.dealers
                        persisted = await client.get(
                            "/api/v1/workbench/insights",
                            params={"scope": scope, "planning_year": 2027, "preset_id": preset},
                        )
                        assert persisted.status_code == 200
                        assert (
                            persisted.json()["data"]["record"]["createdAt"] == record["createdAt"]
                        )
                        entry["persisted"] = True
                    else:
                        entry["error"] = response.json().get("msg", "request_failed")
                results.append(entry)
                (output / "results.json").write_text(
                    json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
                )
                print(
                    json.dumps(
                        {k: v for k, v in entry.items() if k not in {"metadata", "attempts"}},
                        ensure_ascii=True,
                    ),
                    flush=True,
                )
    return 0 if all(r.get("status", 200) == 200 for r in results) else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True, help="New output directory")
    parser.add_argument("--dealers", type=int, default=300)
    parser.add_argument(
        "--live", action="store_true", help="Call configured LLM with synthetic data"
    )
    parser.add_argument("--presets", nargs="+", default=["comprehensive", "quadrant", "structure"])
    arguments = parser.parse_args()
    if arguments.dealers < 6:
        parser.error("--dealers must be at least 6")
    raise SystemExit(asyncio.run(evaluate(arguments)))
