"""Add Resource Studio V17 distributor hierarchy and supplied YoY fields."""

from alembic import op

revision = "20261112_01"
down_revision = "20261102_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Some target databases received this DBA-managed DDL before the application release.
    op.execute(
        """
        ALTER TABLE data.distributor_sellin_resource_history
            ADD COLUMN IF NOT EXISTS sd VARCHAR(255),
            ADD COLUMN IF NOT EXISTS rsm VARCHAR(255),
            ADD COLUMN IF NOT EXISTS distributor_status VARCHAR(255),
            ADD COLUMN IF NOT EXISTS yoy_vol_24_25 NUMERIC(10, 2),
            ADD COLUMN IF NOT EXISTS yoy_c3_24_25 NUMERIC(10, 2),
            ADD COLUMN IF NOT EXISTS mrd_2026 NUMERIC(10, 2),
            ADD COLUMN IF NOT EXISTS reb_2026 NUMERIC(10, 2),
            ADD COLUMN IF NOT EXISTS btl_2026 NUMERIC(10, 2),
            ADD COLUMN IF NOT EXISTS capex_2026 NUMERIC(10, 2),
            ADD COLUMN IF NOT EXISTS yield_2026 NUMERIC(10, 2)
        """
    )


def downgrade() -> None:
    raise RuntimeError(
        "Do not drop distributor hierarchy or YoY source columns during application rollback."
    )
