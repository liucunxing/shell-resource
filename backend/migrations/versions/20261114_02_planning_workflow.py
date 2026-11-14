"""Add isolated planning versions and department confirmation without deleting data."""

from alembic import op

revision = "20261114_02"
down_revision = "20261114_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # One command per execute: asyncpg does not prepare multi-command SQL strings.
    commands = [
        """CREATE TABLE IF NOT EXISTS data.planning_versions (
            id VARCHAR(32) PRIMARY KEY, name VARCHAR(100) NOT NULL,
            planning_year INTEGER NOT NULL, source_version_id VARCHAR(32),
            published BOOLEAN NOT NULL DEFAULT FALSE, open BOOLEAN NOT NULL DEFAULT FALSE,
            deadline TIMESTAMPTZ, revision INTEGER NOT NULL DEFAULT 0,
            created_by VARCHAR(255) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""",
        """CREATE INDEX IF NOT EXISTS ix_planning_versions_year
            ON data.planning_versions(planning_year)""",
        """ALTER TABLE data.budgets ADD COLUMN IF NOT EXISTS planning_version_id VARCHAR(32),
            ADD COLUMN IF NOT EXISTS initiative_key VARCHAR(64),
            ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE""",
        """CREATE INDEX IF NOT EXISTS ix_budgets_planning_version_id
            ON data.budgets(planning_version_id)""",
        """CREATE UNIQUE INDEX IF NOT EXISTS ux_budgets_version_initiative
            ON data.budgets(planning_version_id, initiative_key)
            WHERE planning_version_id IS NOT NULL""",
        # Preserve the previous uniqueness rule for legacy budgets, while isolating new versions.
        """CREATE UNIQUE INDEX IF NOT EXISTS ux_budgets_legacy_business
            ON data.budgets(planning_year, sector, department, resource_type, initiative_name)
            WHERE planning_version_id IS NULL""",
        """CREATE UNIQUE INDEX IF NOT EXISTS ux_budgets_version_business
            ON data.budgets(planning_version_id, sector, department, resource_type, initiative_name)
            WHERE planning_version_id IS NOT NULL""",
        """ALTER TABLE data.budgets DROP CONSTRAINT IF EXISTS uq_budgets_business_key""",
        # budget_id now carries the version boundary; history_key retains SD/RSM identity.
        """CREATE UNIQUE INDEX IF NOT EXISTS ux_allocation_budget_identity
            ON data.budgets_distributor(budget_id, (COALESCE(history_key, distributor_code)))
            WHERE budget_id IS NOT NULL""",
        """CREATE UNIQUE INDEX IF NOT EXISTS ux_allocation_legacy_business
            ON data.budgets_distributor(planning_year, sector, department, resource_type,
                initiative_name, distributor_code)
            WHERE budget_id IS NULL""",
        """ALTER TABLE data.budgets_distributor
            DROP CONSTRAINT IF EXISTS uq_distributor_budgets_business_key""",
        """CREATE TABLE IF NOT EXISTS data.initiative_workflows (
            budget_id BIGINT PRIMARY KEY, publication_id BIGINT,
            confirmed_publication_id BIGINT, confirmed_by VARCHAR(255),
            confirmed_at TIMESTAMPTZ, requires_resubmission BOOLEAN NOT NULL DEFAULT FALSE,
            return_reason TEXT, change_reason VARCHAR(160) NOT NULL DEFAULT ''
        )""",
    ]
    for command in commands:
        op.execute(command)


def downgrade() -> None:
    raise RuntimeError("Retain planning versions and submission audit when rolling back code.")
