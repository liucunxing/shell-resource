"""Read-only mapping for the distributor history table loaded by the data team."""

from sqlalchemy import Column, Numeric, String, Table

from app.models.do.base import BaseDO

distributor_sellin_resource_history = Table(
    "distributor_sellin_resource_history",
    BaseDO.metadata,
    Column("distributor_code", String(255)),
    Column("distributor_name", String(255)),
    Column("volume_2024", Numeric(10, 2)),
    Column("c3_2024", Numeric(10, 2)),
    Column("volume_2025", Numeric(10, 2)),
    Column("c3_2025", Numeric(10, 2)),
    Column("volume_2026", Numeric(10, 2)),
    Column("c3_2026", Numeric(10, 2)),
    Column("mrd_2025", Numeric(10, 2)),
    Column("reb_2025", Numeric(10, 2)),
    Column("btl_2025", Numeric(10, 2)),
    Column("capex_2025", Numeric(10, 2)),
    Column("yield_2025", Numeric(10, 2)),
    Column("resource_total", Numeric(10, 2)),
    Column("resource_uc3", Numeric(10, 2)),
    schema="data",
)
