"""Add role-scoped business-line assignments to user permissions.

Revision ID: 20261009_01
Revises:
Create Date: 2026-10-09
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "20261009_01"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE data.user_permissions
            ADD COLUMN IF NOT EXISTS sector VARCHAR(32)[];
        """
    )

    op.execute(
        """
        ALTER TABLE data.user_permissions
            ADD CONSTRAINT ck_user_permissions_role_sector_count
            CHECK (
                COALESCE(
                    CASE role
                        WHEN 'owner' THEN cardinality(sector) = 1
                        WHEN 'lead' THEN cardinality(sector) BETWEEN 1 AND 2
                        WHEN 'management' THEN COALESCE(cardinality(sector), 0) = 0
                        WHEN 'admin' THEN COALESCE(cardinality(sector), 0) = 0
                        ELSE FALSE
                    END,
                    FALSE
                )
            ) NOT VALID;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE data.user_permissions
            DROP CONSTRAINT IF EXISTS ck_user_permissions_role_sector_count;
        """
    )
    op.execute(
        """
        ALTER TABLE data.user_permissions
            DROP COLUMN IF EXISTS sector;
        """
    )
