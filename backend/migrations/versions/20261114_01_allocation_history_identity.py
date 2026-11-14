"""Preserve distributor SD/RSM identity without overwriting distributor codes."""
from alembic import op

revision = "20261114_01"
down_revision = "20261112_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE data.budgets_distributor
            ADD COLUMN IF NOT EXISTS history_key VARCHAR(80),
            ADD COLUMN IF NOT EXISTS sd VARCHAR(255),
            ADD COLUMN IF NOT EXISTS rsm VARCHAR(255)
    """)


def downgrade() -> None:
    raise RuntimeError("Retain allocation identity columns when rolling back application code.")
