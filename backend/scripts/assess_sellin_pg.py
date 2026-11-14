"""Read-only full-table aggregates; never exports business rows or credentials."""

import argparse
import asyncio
import json
import re
import sys
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from app.core.config import get_settings  # noqa: E402

TABLE = "data.distributor_sellin_resource_history"


async def assess(report_path: Path) -> None:
    engine = create_async_engine(
        get_settings().database_url.get_secret_value(),
        hide_parameters=True,
        connect_args={
            "timeout": 15,
            "server_settings": {
                "default_transaction_read_only": "on",
                "statement_timeout": "30000",
            },
        },
    )
    report = {"checked_at": datetime.now(UTC).isoformat(), "table": TABLE}
    try:
        async with engine.connect() as conn:

            async def query(sql: str) -> list[dict]:
                return [dict(row) for row in (await conn.execute(text(sql))).mappings()]

            report["connection"] = await query(
                "select current_database() as database, "
                "current_setting('transaction_read_only') as read_only"
            )
            columns = await query(
                "select column_name,data_type,is_nullable from information_schema.columns "
                "where table_schema='data' and table_name='distributor_sellin_resource_history' "
                "order by ordinal_position"
            )
            report["columns"] = columns
            report["comments"] = await query(
                "select a.attname as column_name, col_description(a.attrelid,a.attnum) as comment "
                "from pg_attribute a where a.attrelid='data.distributor_sellin_resource_history'"
                "::regclass and a.attnum>0 and not a.attisdropped"
            )
            report["coverage"] = await query(f"""
                select sector, count(*) as rows, count(distinct distributor_code) as codes,
                count(distinct sd) as sd_count, count(distinct rsm) as rsm_count
                from {TABLE} group by sector order by sector
            """)
            report["status"] = await query(f"""
                select sector, distributor_status, count(*) as rows from {TABLE}
                group by sector,distributor_status order by sector,distributor_status
            """)
            report["keys"] = await query(f"""
                select count(*) as rows,
                count(distinct (sector,distributor_code)) as distinct_sector_code,
                count(distinct distributor_code) as distinct_code,
                count(*) filter(where nullif(trim(sector),'') is null) as missing_sector,
                count(*) filter(where nullif(trim(distributor_code),'') is null) as missing_code,
                count(*) filter(where nullif(trim(distributor_name),'') is null) as missing_name,
                count(*) filter(where nullif(trim(sd),'') is null) as missing_sd,
                count(*) filter(where nullif(trim(rsm),'') is null) as missing_rsm,
                count(*) filter(where sector<>upper(trim(sector)) or
                distributor_code<>trim(distributor_code)) as unnormalized_keys
                from {TABLE}
            """)
            report["duplicates"] = await query(f"""
                select count(*) as duplicate_groups, coalesce(sum(n-1),0) as surplus_rows
                from (select count(*) n from {TABLE}
                group by upper(trim(sector)),trim(distributor_code) having count(*)>1) d
            """)
            report["cross_sector_codes"] = await query(f"""
                select count(*) as codes from (select distributor_code from {TABLE}
                group by distributor_code having count(distinct sector)>1) d
            """)
            report["full_grain_duplicates"] = await query(f"""
                select count(*) as duplicate_groups, coalesce(sum(n-1),0) as surplus_rows
                from (select count(*) n from {TABLE}
                group by upper(trim(sector)),trim(distributor_code),sd,rsm having count(*)>1) d
            """)
            report["duplicate_characteristics"] = await query(f"""
                select sector, count(*) as groups,
                count(*) filter(where orgs>1) as multiple_org_groups,
                count(*) filter(where financials>1) as different_financial_groups
                from (select sector,distributor_code,count(*) n,
                count(distinct (sd,rsm)) orgs,
                count(distinct (volume_2024,c3_2024,volume_2025,c3_2025,volume_2026,c3_2026,
                mrd_2025,reb_2025,btl_2025,capex_2025,
                mrd_2026,reb_2026,btl_2026,capex_2026)) financials
                from {TABLE} group by sector,distributor_code having count(*)>1) d
                group by sector order by sector
            """)
            report["yoy_scale_checks"] = {}
            for metric, prefix in (("volume", "vol"), ("c3", "c3")):
                source = f"yoy_{prefix}_24_25"
                ratio = f"({metric}_2025/nullif({metric}_2024,0)-1)"
                report["yoy_scale_checks"][metric] = await query(f"""
                    select count(*) filter(where {metric}_2024<>0
                    and {source} is not null) comparable,
                    count(*) filter(where abs({source}-{ratio})<=0.000011) ratio_matches,
                    count(*) filter(where abs({source}-100*{ratio})<=0.000011) percent_matches
                    from {TABLE}
                """)
            numeric = [c["column_name"] for c in columns if c["data_type"] == "numeric"]
            metrics = {}
            for column in numeric:
                if not re.fullmatch(r"[a-z0-9_]+", column):
                    raise ValueError("Unexpected column identifier")
                metrics[column] = await query(f"""
                    select sector, count(*) as rows,
                    count(*) filter(where {column} is null) as nulls,
                    count(*) filter(where {column}=0) as zeros,
                    count(*) filter(where {column}<0) as negatives,
                    min({column}) as minimum, max({column}) as maximum,
                    sum({column}) as total from {TABLE} group by sector order by sector
                """)
            report["metrics"] = metrics
            for year in (2025, 2026):
                expense = "+".join(f"{c}_{year}" for c in ("mrd", "reb", "btl", "capex"))
                report[f"yield_checks_{year}"] = await query(f"""
                    select sector, count(*) as rows,
                    count(*) filter(where ({expense}) is null) as incomplete_expenses,
                    count(*) filter(where ({expense})=0) as zero_expenses,
                    count(*) filter(where ({expense})<>0 and yield_{year} is not null
                      and c3_{year} is not null) as comparable,
                    count(*) filter(where ({expense})<>0 and yield_{year} is not null
                      and c3_{year} is not null and
                      abs(yield_{year}-c3_{year}/nullif(({expense}),0))>0.011) as ratio_mismatch
                    from {TABLE} group by sector order by sector
                """)
            report["fingerprint"] = await query(f"""
                select count(*) as rows,
                md5(string_agg(row_hash,'' order by row_hash)) as digest
                from (select md5(row_to_json(t)::text) row_hash from {TABLE} t) h
            """)
            report["related_tables"] = await query(
                "select table_name from information_schema.tables where table_schema='data' "
                "and table_name not like '%bak%' order by table_name"
            )
        report["success"] = True
    except Exception as exc:
        report.update(success=False, error_type=type(exc).__name__)
    finally:
        await engine.dispose()
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "success": report["success"],
                "report": str(report_path),
                "keys": report.get("keys"),
                "coverage": report.get("coverage"),
                "duplicates": report.get("duplicates"),
            },
            ensure_ascii=False,
            default=str,
        )
    )
    if not report["success"]:
        raise SystemExit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", required=True, type=Path)
    asyncio.run(assess(parser.parse_args().report))
