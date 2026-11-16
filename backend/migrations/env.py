import asyncio
from logging.config import fileConfig
from typing import Any

from alembic import context
from sqlalchemy import Connection, pool
from sqlalchemy.ext.asyncio import async_engine_from_config

from app.core.config import get_settings
from app.models.do.base import BaseDO

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

settings = get_settings()
config.set_main_option(
    "sqlalchemy.url", settings.database_url.get_secret_value().replace("%", "%%")
)
target_metadata = BaseDO.metadata


def include_object(
    object_: Any, name: str, type_: str, reflected: bool, compare_to: Any,
) -> bool:
    # V20 removed Insight runtime models, while its persisted history is retained.
    # Suppress only drops of these two unmapped, reflected tables, not other changes.
    return not (
        type_ == "table" and reflected and compare_to is None
        and getattr(object_, "schema", None) == "data"
        and name in {"insight_records", "insight_prompts"}
    )


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        include_object=include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection, target_metadata=target_metadata, compare_type=True,
        include_object=include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


if config.attributes.get("connection") is not None:
    do_run_migrations(config.attributes["connection"])
elif context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_async_migrations())
