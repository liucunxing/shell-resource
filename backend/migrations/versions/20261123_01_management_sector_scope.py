"""Allow explicit management Sector grants; legacy empty grants remain denied."""

from alembic import op

revision = "20261123_01"
down_revision = "20261119_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '2s'")
    op.execute("""
        ALTER TABLE data.user_permissions
        DROP CONSTRAINT IF EXISTS ck_user_permissions_role_sector_count
    """)
    op.execute("""
        ALTER TABLE data.user_permissions
        ADD CONSTRAINT ck_user_permissions_role_sector_count CHECK (COALESCE(
            CASE role
                WHEN 'owner' THEN cardinality(sector) = 1
                WHEN 'lead' THEN cardinality(sector) BETWEEN 1 AND 4
                WHEN 'admin' THEN COALESCE(cardinality(sector), 0) = 0
                WHEN 'management' THEN COALESCE(cardinality(sector), 0) = 0 OR (
                    cardinality(sector) BETWEEN 1 AND 4
                    AND array_ndims(sector) = 1
                    AND sector <@ ARRAY['PCMO','CRTO','B2B','OEM']::varchar[]
                    AND array_position(sector, NULL) IS NULL
                    AND cardinality(array_positions(sector, 'PCMO')) <= 1
                    AND cardinality(array_positions(sector, 'CRTO')) <= 1
                    AND cardinality(array_positions(sector, 'B2B')) <= 1
                    AND cardinality(array_positions(sector, 'OEM')) <= 1
                )
                ELSE FALSE
            END, FALSE
        )) NOT VALID
    """)


def downgrade() -> None:
    # Do not silently discard grants or let old code restore unrestricted access.
    op.execute("SET LOCAL lock_timeout = '2s'")
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM data.user_permissions
                       WHERE role='management' AND cardinality(sector) > 0) THEN
                RAISE EXCEPTION 'Remove management grants with access disabled before downgrade';
            END IF;
        END $$
    """)
    op.execute("""
        ALTER TABLE data.user_permissions
        DROP CONSTRAINT ck_user_permissions_role_sector_count
    """)
    op.execute("""
        ALTER TABLE data.user_permissions
        ADD CONSTRAINT ck_user_permissions_role_sector_count CHECK (COALESCE(
            CASE role
                WHEN 'owner' THEN cardinality(sector) = 1
                WHEN 'lead' THEN cardinality(sector) BETWEEN 1 AND 4
                WHEN 'management' THEN COALESCE(cardinality(sector), 0) = 0
                WHEN 'admin' THEN COALESCE(cardinality(sector), 0) = 0
                ELSE FALSE
            END, FALSE
        )) NOT VALID
    """)
