"""Keep the Owner's editor step and reserve acknowledgement with the draft."""

from alembic import op

revision = "20261117_01"
down_revision = "20261116_02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '2s'")
    op.execute("ALTER TABLE data.budgets ADD COLUMN IF NOT EXISTS editor_state JSON")


def downgrade() -> None:
    raise RuntimeError("Retain saved Owner editor state with the draft.")
