"""Bind explicit business period confirmation to one source batch; dry-run by default.

Writes only workspace_config.reference/revision and its audit entry, never source data.
The source digest uses the same full-row PostgreSQL algorithm as assess_sellin_pg.py.
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
from app.core.history_policy import verified_history_coverage  # noqa: E402
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
                digest = await session.scalar(ReferenceRepository.fingerprint_statement())
                if digest != args.source_fingerprint:
                    raise ValueError("源批次指纹已变化，必须重新核对该批次期间")
                confirmation = {
                    "sourceFingerprint": digest, "year": 2026, "startMonth": 1,
                    "actualThroughMonth": args.actual_month,
                    "investmentThroughMonth": args.investment_month,
                    "confirmedAt": datetime.now(UTC).isoformat(),
                }
                if not verified_history_coverage(
                    {"historyCoverageConfirmation": confirmation}, digest,
                ):
                    raise ValueError("期间确认参数无效")
                before = {
                    "revision": config.revision,
                    "displaySettings": (config.reference or {}).get("displaySettings", {}),
                    "historyCoverageConfirmation": (config.reference or {}).get(
                        "historyCoverageConfirmation",
                    ),
                }
                display = {**before["displaySettings"], "ytdCutoffMonth": args.actual_month}
                report = {
                    "applied": args.apply, "sourceFingerprint": digest,
                    "sourceUnchanged": True, "beforeRevision": config.revision,
                    "confirmation": confirmation, "displaySettings": display,
                    "writeTargets": ["data.workspace_config", "data.budget_change_logs"],
                }
                if args.apply:
                    if args.expected_revision is None or config.revision != args.expected_revision:
                        raise ValueError("配置revision已变化，须重新dry-run并传--expected-revision")
                    config.reference = {
                        **(config.reference or {}), "displaySettings": display,
                        "historyCoverageConfirmation": confirmation,
                    }
                    config.revision += 1
                    WorkspaceRepository(session).add_log(
                        0, "HISTORY_COVERAGE_CONFIRM", "business-confirmation", before,
                        {"revision": config.revision, "displaySettings": display,
                         "historyCoverageConfirmation": confirmation},
                        "业务确认当前源批次Actual与费用累计期间；新批次需重新确认",
                    )
                    await session.flush()
                    if await session.scalar(ReferenceRepository.fingerprint_statement()) != digest:
                        raise ValueError("操作期间源批次已变化，配置修改已回滚")
                    report["afterRevision"] = config.revision
                return report
    finally:
        await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-fingerprint", required=True)
    parser.add_argument("--actual-month", type=int, required=True)
    parser.add_argument("--investment-month", type=int, required=True)
    parser.add_argument("--expected-revision", type=int)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    result = asyncio.run(confirm(args))
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
