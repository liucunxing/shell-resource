"""Confirm dealer target units/periods for one PG source batch; dry-run by default.

Only --apply writes workspace_config plus audit. Source rows are never modified.
Both years require explicit periods; the service still gates YTD Phasing on matching
verified Actual coverage. The original history confirmation is not changed here.
"""

import argparse
import asyncio
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from app.core.config import get_settings  # noqa: E402
from app.core.history_policy import (  # noqa: E402
    verified_dealer_target_coverage,
    verified_history_coverage,
)
from app.models.do.workspace import WorkspaceConfigDO  # noqa: E402
from app.repositories.reference_repository import ReferenceRepository  # noqa: E402
from app.repositories.workspace_repository import WorkspaceRepository  # noqa: E402


async def confirm(args: argparse.Namespace) -> dict:
    engine = create_async_engine(
        get_settings().database_url.get_secret_value(), hide_parameters=True,
        connect_args={"timeout": 15, "server_settings": {"statement_timeout": "30000"}},
    )
    try:
        async with AsyncSession(engine) as session:
            async with session.begin():
                config = (await session.scalars(
                    select(WorkspaceConfigDO).where(WorkspaceConfigDO.id == 1).with_for_update()
                )).one()
                repository = ReferenceRepository(session)
                digest = await session.scalar(repository.fingerprint_statement())
                if digest != args.source_fingerprint:
                    raise ValueError("源批次指纹已变化，须重新核对target单位及期间")
                confirmation = {
                    "sourceFingerprint": digest, "sourceUnit": args.source_unit,
                    "periods": {
                        "2025": {"startMonth": 1, "endMonth": args.target_2025_end_month},
                        "2026": {"startMonth": 1, "endMonth": args.target_2026_end_month},
                    },
                    "confirmedAt": datetime.now(UTC).isoformat(),
                }
                if not verified_dealer_target_coverage(
                    {"dealerTargetConfirmation": confirmation}, digest,
                ):
                    raise ValueError(
                        "target单位/期间参数无效，2025必须全年，2026必须从1月至有效截止月",
                    )
                rows = await repository.list_dealers()
                if not rows or not all(
                    rows[0].get(f"_has_target_{year}") for year in (2025, 2026)
                ):
                    raise ValueError("源表target_2025/target_2026字段不完整，不可确认")
                coverage = verified_history_coverage(config.reference, digest)
                before = {
                    "revision": config.revision,
                    "dealerTargetConfirmation": (config.reference or {}).get(
                        "dealerTargetConfirmation",
                    ),
                }
                report = {
                    "applied": args.apply, "sourceFingerprint": digest,
                    "sourceUnchanged": True, "beforeRevision": config.revision,
                    "confirmation": confirmation,
                    "actualThroughMonth": coverage["actualThroughMonth"] if coverage else None,
                    "ytdSamePeriod": bool(coverage and coverage["actualThroughMonth"]
                                          == args.target_2026_end_month),
                    "writeTargets": ["data.workspace_config", "data.budget_change_logs"],
                }
                if args.apply:
                    if args.expected_revision is None or config.revision != args.expected_revision:
                        raise ValueError("配置revision已变化，须重新dry-run并传--expected-revision")
                    config.reference = {
                        **(config.reference or {}), "dealerTargetConfirmation": confirmation,
                    }
                    config.revision += 1
                    WorkspaceRepository(session).add_log(
                        0, "DEALER_TARGET_CONFIRM", "business-confirmation", before,
                        {"revision": config.revision, "dealerTargetConfirmation": confirmation},
                        "业务确认经销商target单位和期间；仅对当前源批次生效",
                    )
                    await session.flush()
                    if await session.scalar(repository.fingerprint_statement()) != digest:
                        raise ValueError("操作期间源批次已变化，配置修改已回滚")
                    report["afterRevision"] = config.revision
                return report
    finally:
        await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-fingerprint", required=True)
    parser.add_argument("--source-unit", choices=("L", "KL"), required=True)
    parser.add_argument("--target-2025-end-month", type=int, required=True)
    parser.add_argument("--target-2026-end-month", type=int, required=True)
    parser.add_argument("--expected-revision", type=int)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    result = asyncio.run(confirm(args))
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
