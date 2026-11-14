"""Separate home affiliation from business scope and add historical expense defaults."""

import sqlalchemy as sa
from alembic import op

revision = "20261114_03"
down_revision = "20261114_02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("user_permissions", sa.Column("affiliation_sector", sa.String(32)), schema="data")
    op.add_column(
        "user_permissions", sa.Column("affiliation_department", sa.String(32)), schema="data"
    )
    op.add_column(
        "user_permissions", sa.Column("history_resources", sa.ARRAY(sa.String(32))), schema="data"
    )
    # Do not guess existing users' affiliation or expand their business scope.
    op.add_column(
        "workspace_config",
        sa.Column(
            "role_resources",
            sa.JSON(),
            nullable=False,
            server_default=sa.text(
                '\'{"owner":[],"lead":[],"management":["MRD","SP&A","ICE Rebate","Capex"],'
                '"admin":["MRD","SP&A","ICE Rebate","Capex"]}\''
            ),
        ),
        schema="data",
    )
    op.add_column(
        "workspace_config",
        sa.Column(
            "health_thresholds",
            sa.JSON(),
            nullable=False,
            server_default=sa.text(
                '\'{"concentrationYellow": 5, "concentrationRed": 10, '
                '"dealerYellow": 3, "dealerRed": 6}\''
            ),
        ),
        schema="data",
    )


def downgrade() -> None:
    raise RuntimeError(
        "Roll back application code only; retain affiliation and authorization data."
    )
