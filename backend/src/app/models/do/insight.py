"""Persisted prompt versions and generated six-point Insight records."""

from sqlalchemy import JSON, BigInteger, Integer, SmallInteger, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.do.base import BaseDO, TimestampMixin


class InsightPromptDO(TimestampMixin, BaseDO):
    __tablename__ = "insight_prompts"
    __table_args__ = (
        UniqueConstraint("planning_year", "scope", name="uq_insight_prompt_year_scope"),
        {"schema": "data"},
    )

    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    planning_year: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    scope: Mapped[str] = mapped_column(String(300), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


class InsightRecordDO(TimestampMixin, BaseDO):
    __tablename__ = "insight_records"
    __table_args__ = {"schema": "data"}

    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    planning_year: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    scope: Mapped[str] = mapped_column(String(300), nullable=False)
    signature: Mapped[str] = mapped_column(String(80), nullable=False)
    prompt_version: Mapped[int] = mapped_column(Integer, nullable=False)
    reference_batch_id: Mapped[str | None] = mapped_column(String(128))
    guide_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by_email: Mapped[str] = mapped_column(String(255), nullable=False)
    record: Mapped[dict] = mapped_column(JSON, nullable=False)
