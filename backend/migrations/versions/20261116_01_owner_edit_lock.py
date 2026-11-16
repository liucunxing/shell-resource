"""Freeze Owner editing at department confirmation, retaining withdrawal locks."""
import sqlalchemy as sa
from alembic import op

revision = "20261116_01"
down_revision = "20261114_03"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("initiative_workflows", sa.Column(
        "owner_edit_locked", sa.Boolean(), nullable=False, server_default=sa.false()
    ), schema="data")
    op.execute("""
        UPDATE data.initiative_workflows w SET owner_edit_locked = true
        WHERE NOT w.requires_resubmission AND (
            w.confirmed_publication_id IS NOT NULL OR EXISTS (
                SELECT 1 FROM data.budget_change_logs l
                WHERE l.budget_id = w.budget_id AND l.operation_type = 'DEPARTMENT_CONFIRM'
                AND l.id > COALESCE((SELECT MAX(r.id) FROM data.budget_change_logs r
                    WHERE r.budget_id = w.budget_id AND r.operation_type = 'DEPARTMENT_RETURN'), 0)
            )
        )
    """)


def downgrade() -> None:
    op.drop_column("initiative_workflows", "owner_edit_locked", schema="data")
