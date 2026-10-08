"""Read-only connectivity and schema inspection. Never prints connection credentials."""

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import get_settings


async def main() -> None:
    settings = get_settings()
    engine = create_async_engine(
        settings.database_url.get_secret_value(),
        connect_args={
            "timeout": 10,
            "server_settings": {"default_transaction_read_only": "on", "statement_timeout": "8000"},
        },
        hide_parameters=True,
    )
    try:
        async with engine.connect() as connection:
            columns = await connection.execute(
                text(
                    "SELECT table_name, column_name, data_type, is_nullable "
                    "FROM information_schema.columns WHERE table_schema='data' "
                    "ORDER BY table_name, ordinal_position"
                )
            )
            print(
                json.dumps(
                    {"connected": True, "columns": [dict(row) for row in columns.mappings()]},
                    ensure_ascii=False,
                )
            )
    except Exception as exc:
        print(
            json.dumps(
                {
                    "connected": False,
                    "error_type": type(exc).__name__,
                    "message": "数据库连接或只读查询未完成；检查网络、登录和配置。",
                },
                ensure_ascii=False,
            )
        )
        raise SystemExit(1) from None
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
