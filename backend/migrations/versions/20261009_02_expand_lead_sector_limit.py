"""Allow department leads to have up to four business lines.

Revision ID: 20261009_02
Revises: 20261009_01
Create Date: 2026-10-09
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "20261009_02"
down_revision = "20261009_01"
branch_labels = None
depends_on = None


def _add_constraint(maximum: int) -> None:
    op.execute(
        f"""
        ALTER TABLE data.user_permissions
            ADD CONSTRAINT ck_user_permissions_role_sector_count
            CHECK (
                COALESCE(
                    CASE role
                        WHEN 'owner' THEN cardinality(sector) = 1
                        WHEN 'lead' THEN cardinality(sector) BETWEEN 1 AND {maximum}
                        WHEN 'management' THEN COALESCE(cardinality(sector), 0) = 0
                        WHEN 'admin' THEN COALESCE(cardinality(sector), 0) = 0
                        ELSE FALSE
                    END,
                    FALSE
                )
            ) NOT VALID;
        """
    )


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE data.user_permissions
            DROP CONSTRAINT IF EXISTS ck_user_permissions_role_sector_count;
        """
    )
    _add_constraint(4)


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE data.user_permissions
            DROP CONSTRAINT IF EXISTS ck_user_permissions_role_sector_count;
        """
    )
    _add_constraint(2)
