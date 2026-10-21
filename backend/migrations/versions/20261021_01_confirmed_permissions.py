"""Configurable historical columns and retained business prompt versions."""

import sqlalchemy as sa
from alembic import op

revision = "20261021_01"
down_revision = "20261014_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "workspace_config",
        sa.Column(
            "department_resources",
            sa.JSON(),
            nullable=False,
            server_default=sa.text(
                '\'{"MKT":["MRD","SP&A"],"ICE":["ICE Rebate","SP&A"],"CAPEX":["Capex"]}\''
            ),
        ),
        schema="data",
    )
    op.add_column(
        "insight_prompts",
        sa.Column(
            "versions",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'"),
        ),
        schema="data",
    )
    op.execute("""UPDATE data.insight_prompts SET versions = json_build_array(
        json_build_object('version', version, 'text', text, 'updatedAt', updated_at)
    )""")


def downgrade() -> None:
    # Keep version history and configuration on rollback; the previous app ignores both.
    raise RuntimeError(
        "Roll back the application only; retain prompt versions and resource mapping."
    )
