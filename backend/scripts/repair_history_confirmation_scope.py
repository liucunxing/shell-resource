"""Re-scope existing period evidence only when the recorded legacy data is unchanged.

Dry-run by default. Only config and audit are written, never source rows.
"""

import argparse
import asyncio
import json
import re
import sys
from pathlib import Path

from sqlalchemy import Text, func, literal, select, text
from sqlalchemy.dialects.postgresql import aggregate_order_by
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from app.core.config import get_settings  # noqa: E402
from app.core.history_policy import verified_history_coverage  # noqa: E402
from app.models.do.distributor_history import (
    distributor_sellin_resource_history as source,  # noqa: E402
)
from app.models.do.workspace import WorkspaceConfigDO  # noqa: E402
from app.repositories.reference_repository import ReferenceRepository  # noqa: E402
from app.repositories.workspace_repository import WorkspaceRepository  # noqa: E402

# Original physical order in the recorded 2026-11-15 source inspection.
LEGACY_COLUMNS = (
    "sector",
    "distributor_code",
    "distributor_name",
    "sd",
    "rsm",
    "volume_2024",
    "c3_2024",
    "volume_2025",
    "c3_2025",
    "volume_2026",
    "c3_2026",
    "reb_2025",
    "mrd_2025",
    "btl_2025",
    "capex_2025",
    "yield_2025",
    "reb_2026",
    "mrd_2026",
    "btl_2026",
    "capex_2026",
    "yield_2026",
    "distributor_status",
    "yoy_vol_24_25",
    "yoy_c3_24_25",
)


def upgraded_confirmation(existing: dict, actual: str, expected: str, history: str) -> dict:
    if any(not re.fullmatch(r"[0-9a-f]{32}", value or "") for value in (actual, expected, history)):
        raise ValueError("无效的源数据摘要")
    if actual != expected:
        raise ValueError("原历史字段已变化，不能沿用旧期间确认")
    if existing.get("sourceFingerprintScope") is not None:
        raise ValueError("仅支持升级旧全表确认；当前scope已变化")
    if not verified_history_coverage(
        {"historyCoverageConfirmation": existing},
        existing.get("sourceFingerprint"),
    ):
        raise ValueError("原期间确认不完整，不能补造")
    return {**existing, "sourceFingerprintScope": "history_2026_v1", "sourceFingerprint": history}


async def repair(args: argparse.Namespace) -> dict:
    engine = create_async_engine(
        get_settings().database_url.get_secret_value(),
        hide_parameters=True,
        connect_args={
            "timeout": 15,
            "server_settings": {
                "statement_timeout": "20000",
                "lock_timeout": "2000",
            },
        },
    )
    try:
        async with AsyncSession(engine) as session, session.begin():
            query = select(WorkspaceConfigDO).where(WorkspaceConfigDO.id == 1)
            config = (await session.scalars(query.with_for_update() if args.apply else query)).one()
            if args.apply:
                if args.expected_revision is None or config.revision != args.expected_revision:
                    raise ValueError("配置revision已变化，须重新dry-run")
                # Keep source verification and config commit in one stable snapshot.
                await session.execute(
                    text("LOCK TABLE data.distributor_sellin_resource_history IN SHARE MODE")
                )
            legacy = select(*[source.c[name] for name in LEGACY_COLUMNS]).subquery()
            hashes = select(
                func.md5(func.row_to_json(legacy.table_valued()).cast(Text)).label("h")
            ).subquery()
            digest = await session.scalar(
                select(
                    func.md5(
                        func.string_agg(
                            hashes.c.h,
                            aggregate_order_by(literal(""), hashes.c.h),
                        )
                    )
                )
            )
            history = await session.scalar(ReferenceRepository.history_fingerprint_statement())
            existing = (config.reference or {}).get("historyCoverageConfirmation") or {}
            confirmation = upgraded_confirmation(
                existing, digest, args.expected_legacy_fingerprint, history
            )
            report = {
                "applied": args.apply,
                "beforeRevision": config.revision,
                "legacyHistoryUnchanged": True,
                "confirmation": confirmation,
            }
            if args.apply:
                config.reference = {
                    **(config.reference or {}),
                    "historyCoverageConfirmation": confirmation,
                }
                config.revision += 1
                WorkspaceRepository(session).add_log(
                    0,
                    "HISTORY_COVERAGE_SCOPE_REPAIR",
                    "history-availability-repair",
                    {"revision": report["beforeRevision"], "historyCoverageConfirmation": existing},
                    {"revision": config.revision, "historyCoverageConfirmation": confirmation},
                    "原24字段校验一致；仅将确认绑定到2026 Actual/费用字段，保留原月份和确认时间",
                )
                await session.flush()
                report["afterRevision"] = config.revision
            return report
    finally:
        await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expected-legacy-fingerprint", required=True)
    parser.add_argument("--expected-revision", type=int)
    parser.add_argument("--apply", action="store_true")
    print(json.dumps(asyncio.run(repair(parser.parse_args())), ensure_ascii=False, indent=2))
