from collections.abc import Sequence

from sqlalchemy import Numeric, RowMapping, Text, delete, func, literal, select
from sqlalchemy.dialects.postgresql import JSONB, aggregate_order_by
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import Select

from app.models.do.distributor_history import distributor_sellin_resource_history
from app.models.do.workspace import WorkspaceReferenceDO


class ReferenceRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_dealers(
        self,
        dealer_ids: list[str] | None = None,
        sectors: tuple[str, ...] | None = None,
        *, include_source_fingerprint: bool = False,
    ) -> Sequence[RowMapping]:
        statement = select(distributor_sellin_resource_history)
        # The data team owns these optional source columns. JSON projection keeps
        # old source schemas and existing SQLite previews readable without DDL.
        is_postgres = self.session.get_bind().dialect.name == "postgresql"
        source_json = func.row_to_json(
            distributor_sellin_resource_history.table_valued(),
        ).cast(JSONB)
        for name in ("target_2025", "target_2026", "phasing_2025", "phasing_2026"):
            value = (
                source_json.op("->>")(literal(name)).cast(Numeric)
                if is_postgres else literal(None)
            )
            present = func.jsonb_exists(source_json, name) if is_postgres else literal(False)
            statement = statement.add_columns(value.label(name), present.label(f"_has_{name}"))
        if include_source_fingerprint:
            # One PostgreSQL statement sees the rows and full-batch fingerprint at
            # the same snapshot, even if the source is refreshed concurrently.
            fingerprint = (
                self.fingerprint_statement().scalar_subquery()
                if self.session.get_bind().dialect.name == "postgresql" else literal(None)
            )
            statement = statement.add_columns(fingerprint.label("_source_fingerprint"))
        if dealer_ids is not None:
            statement = statement.where(
                distributor_sellin_resource_history.c.distributor_code.in_(dealer_ids)
            )
        if sectors is not None:
            if not sectors:
                return []
            statement = statement.where(distributor_sellin_resource_history.c.sector.in_(sectors))
        result = await self.session.execute(
            statement.order_by(
                distributor_sellin_resource_history.c.distributor_code,
                distributor_sellin_resource_history.c.sector,
            )
        )
        return result.mappings().all()

    async def list_directory(self, sectors: tuple[str, ...] | None = None) -> Sequence[RowMapping]:
        """Identity/status only: saving allocations does not need historical metrics."""
        if sectors is not None and not sectors:
            return []
        source = distributor_sellin_resource_history.c
        statement = select(
            source.distributor_code, source.distributor_name, source.sector,
            source.sd, source.rsm, source.distributor_status,
        )
        if sectors is not None:
            statement = statement.where(source.sector.in_(sectors))
        result = await self.session.execute(
            statement.order_by(source.distributor_code, source.sector)
        )
        return result.mappings().all()

    @staticmethod
    def fingerprint_statement() -> Select:
        source = distributor_sellin_resource_history.alias("history_source_batch")
        hashes = select(
            func.md5(func.row_to_json(source.table_valued()).cast(Text)).label("row_hash")
        ).subquery()
        return select(func.md5(func.string_agg(
            hashes.c.row_hash, aggregate_order_by(literal(""), hashes.c.row_hash),
        )))

    async def count_dealers(self) -> int:
        statement = select(func.count()).select_from(distributor_sellin_resource_history)
        return int((await self.session.scalar(statement)) or 0)

    async def clear_year(self, planning_year: int) -> None:
        await self.session.execute(
            delete(WorkspaceReferenceDO).where(WorkspaceReferenceDO.planning_year == planning_year)
        )

    def add(self, entity: WorkspaceReferenceDO) -> None:
        self.session.add(entity)
