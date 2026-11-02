"""Durable receiver sessions; assertions and raw session credentials are never stored."""

from sqlalchemy import BigInteger, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.do.base import BaseDO


class PortalSessionDO(BaseDO):
    __tablename__ = "portal_embed_sessions"
    __table_args__ = {"schema": "data"}

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    subject: Mapped[str] = mapped_column(String(128), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    permission_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    permission_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    csrf_token: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)


class PortalContextDO(BaseDO):
    __tablename__ = "portal_embed_contexts"
    __table_args__ = {"schema": "data"}

    session_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("data.portal_embed_sessions.id", ondelete="CASCADE"),
        primary_key=True,
    )
    instance_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    request_id: Mapped[str] = mapped_column(String(36), nullable=False)
    embedder_origin: Mapped[str] = mapped_column(String(255), nullable=False)
    app_id: Mapped[str] = mapped_column(String(128), nullable=False)
    landing_path: Mapped[str] = mapped_column(String(255), nullable=False)
