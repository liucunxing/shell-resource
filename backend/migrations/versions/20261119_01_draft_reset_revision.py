"""Mark the first draft revision in the current allocation cycle."""

import sqlalchemy as sa
from alembic import op

revision = "20261119_01"
down_revision = "20261117_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '2s'")
    op.add_column(
        "initiative_workflows", sa.Column("draft_reset_revision", sa.Integer()), schema="data"
    )


def downgrade() -> None:
    # Losing a reset boundary would silently restore old submissions to active calculations.
    used = op.get_bind().scalar(sa.text(
        "SELECT EXISTS (SELECT 1 FROM data.initiative_workflows "
        "WHERE draft_reset_revision IS NOT NULL)"
    ))
    if used:
        raise RuntimeError("Keep reset boundaries for versions whose drafts were cleared.")
    op.drop_column("initiative_workflows", "draft_reset_revision", schema="data")
