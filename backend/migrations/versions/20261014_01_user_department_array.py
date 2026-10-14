"""Store user departments as varchar[]; retain project department as a scalar."""

from alembic import op

revision = "20261014_01"
down_revision = "20261009_02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE data.user_permissions ALTER COLUMN department DROP DEFAULT")
    op.execute("""
        ALTER TABLE data.user_permissions
        ALTER COLUMN department TYPE VARCHAR(32)[]
        USING CASE WHEN department IS NULL OR btrim(department) = ''
            THEN ARRAY[]::VARCHAR(32)[]
            ELSE ARRAY[upper(btrim(department))]::VARCHAR(32)[] END;
    """)
    op.execute(
        "ALTER TABLE data.user_permissions "
        "ALTER COLUMN department SET DEFAULT ARRAY[]::VARCHAR(32)[]"
    )
    op.execute("ALTER TABLE data.user_permissions ALTER COLUMN department SET NOT NULL")


def downgrade() -> None:
    # Never silently discard a user's second department.
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM data.user_permissions
                       WHERE cardinality(department) > 1) THEN
                RAISE EXCEPTION 'Cannot downgrade: users have multiple departments';
            END IF;
        END $$;
    """)
    op.execute("ALTER TABLE data.user_permissions ALTER COLUMN department DROP DEFAULT")
    op.execute("ALTER TABLE data.user_permissions ALTER COLUMN department DROP NOT NULL")
    op.execute(
        "ALTER TABLE data.user_permissions "
        "ALTER COLUMN department TYPE VARCHAR(32) USING department[1]"
    )
