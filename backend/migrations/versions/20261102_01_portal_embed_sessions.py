"""Add isolated, durable Portal receiver sessions and instance contexts."""

import sqlalchemy as sa
from alembic import op

revision = "20261102_01"
down_revision = "20261021_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "portal_embed_sessions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("subject", sa.String(128), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("permission_id", sa.BigInteger(), nullable=False),
        sa.Column("permission_fingerprint", sa.String(64), nullable=False),
        sa.Column("csrf_token", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.BigInteger(), nullable=False),
        schema="data",
    )
    op.create_index(
        "ix_data_portal_embed_sessions_expires_at",
        "portal_embed_sessions",
        ["expires_at"],
        schema="data",
    )
    op.create_table(
        "portal_embed_contexts",
        sa.Column(
            "session_id",
            sa.String(36),
            sa.ForeignKey("data.portal_embed_sessions.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("instance_id", sa.String(36), primary_key=True),
        sa.Column("request_id", sa.String(36), nullable=False),
        sa.Column("embedder_origin", sa.String(255), nullable=False),
        sa.Column("app_id", sa.String(128), nullable=False),
        sa.Column("landing_path", sa.String(255), nullable=False),
        schema="data",
    )


def downgrade() -> None:
    # Receiver sessions are transient; business tables and FineReport are untouched.
    op.drop_table("portal_embed_contexts", schema="data")
    op.drop_index(
        "ix_data_portal_embed_sessions_expires_at",
        table_name="portal_embed_sessions",
        schema="data",
    )
    op.drop_table("portal_embed_sessions", schema="data")
