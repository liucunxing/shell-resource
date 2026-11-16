"""Version lifecycle and submission workflow; allocation snapshots remain immutable."""

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.do.base import BaseDO


class PlanningVersionDO(BaseDO):
    __tablename__ = "planning_versions"
    __table_args__ = {"schema": "data"}

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    planning_year: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    source_version_id: Mapped[str | None] = mapped_column(String(32))
    published: Mapped[bool] = mapped_column(nullable=False, default=False)
    open: Mapped[bool] = mapped_column(nullable=False, default=False)
    deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class InitiativeWorkflowDO(BaseDO):
    __tablename__ = "initiative_workflows"
    __table_args__ = {"schema": "data"}

    budget_id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"), primary_key=True
    )
    publication_id: Mapped[int | None] = mapped_column(BigInteger)
    confirmed_publication_id: Mapped[int | None] = mapped_column(BigInteger)
    confirmed_by: Mapped[str | None] = mapped_column(String(255))
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    owner_edit_locked: Mapped[bool] = mapped_column(nullable=False, default=False)
    requires_resubmission: Mapped[bool] = mapped_column(nullable=False, default=False)
    return_reason: Mapped[str | None] = mapped_column(Text)
    change_reason: Mapped[str] = mapped_column(String(160), nullable=False, default="")
