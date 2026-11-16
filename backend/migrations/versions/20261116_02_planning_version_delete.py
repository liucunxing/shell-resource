"""Retain deleted planning versions and their submission history for audit."""

from alembic import op

revision = "20261116_02"
down_revision = "20261116_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '2s'")
    op.execute("ALTER TABLE data.planning_versions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ")


def downgrade() -> None:
    raise RuntimeError("Retain deleted planning versions and their audit history.")
