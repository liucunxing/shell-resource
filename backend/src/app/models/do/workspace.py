"""Small relational mappings used by the V1.4 API workbench."""

from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    JSON,
    BigInteger,
    DateTime,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.do.base import BaseDO, TimestampMixin


def default_budget_reasons() -> list[dict]:
    return [
        {"id": "reserve", "label": "新增经销商预留", "enabled": True},
        {"id": "unallocated", "label": "无法分配到经销商", "enabled": True},
        {"id": "other", "label": "其他支出", "enabled": True},
    ]


class UserPermissionDO(TimestampMixin, BaseDO):
    __tablename__ = "user_permissions"
    __table_args__ = {"schema": "data"}

    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    department: Mapped[str | None] = mapped_column(String(32))
    sector: Mapped[str | None] = mapped_column(String(32))
    enabled: Mapped[bool] = mapped_column(nullable=False, default=True)


class OtherBudgetDO(TimestampMixin, BaseDO):
    __tablename__ = "other_budgets"
    __table_args__ = {"schema": "data"}

    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    budget_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    reason_id: Mapped[str] = mapped_column(String(64), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    note: Mapped[str | None] = mapped_column(String(500))


class WorkspacePublicationDO(BaseDO):
    __tablename__ = "workspace_publications"
    __table_args__ = {"schema": "data"}

    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    budget_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    department: Mapped[str] = mapped_column(String(32), nullable=False)
    publication_number: Mapped[int] = mapped_column(Integer, nullable=False)
    published_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot: Mapped[dict] = mapped_column(JSON, nullable=False)
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class WorkspaceConfigDO(TimestampMixin, BaseDO):
    __tablename__ = "workspace_config"
    __table_args__ = {"schema": "data"}

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True, default=1)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    budget_reasons: Mapped[list] = mapped_column(
        JSON, nullable=False, default=default_budget_reasons
    )
    budget_reason_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    guide: Mapped[dict] = mapped_column(
        JSON,
        nullable=False,
        default=lambda: {
            "version": 1,
            "text": "仅依据同期间授权数据分析，不推断因果，不生成预测。",
        },
    )
    reference: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)


class WorkspaceReferenceDO(TimestampMixin, BaseDO):
    __tablename__ = "workspace_references"
    __table_args__ = {"schema": "data"}

    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    planning_year: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    batch_id: Mapped[str] = mapped_column(String(128), nullable=False)
    as_of: Mapped[str] = mapped_column(String(32), nullable=False)
    dealer_id: Mapped[str] = mapped_column(String(255), nullable=False)
    dealer_name: Mapped[str | None] = mapped_column(String(255))
    vol2024: Mapped[Decimal | None] = mapped_column(Numeric(20, 4))
    c32024: Mapped[Decimal | None] = mapped_column(Numeric(20, 4))
    vol2025: Mapped[Decimal | None] = mapped_column(Numeric(20, 4))
    c32025: Mapped[Decimal | None] = mapped_column(Numeric(20, 4))
    vol2026_ytd: Mapped[Decimal | None] = mapped_column(Numeric(20, 4))
    c32026_ytd: Mapped[Decimal | None] = mapped_column(Numeric(20, 4))
    mrd2025: Mapped[Decimal | None] = mapped_column(Numeric(20, 4))
    spa2025: Mapped[Decimal | None] = mapped_column(Numeric(20, 4))
    ice2025: Mapped[Decimal | None] = mapped_column(Numeric(20, 4))
    capex2025: Mapped[Decimal | None] = mapped_column(Numeric(20, 4))


class BudgetChangeLogDO(BaseDO):
    __tablename__ = "budget_change_logs"
    __table_args__ = {"schema": "data"}

    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    budget_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    operation_type: Mapped[str] = mapped_column(String(32), nullable=False)
    before_data: Mapped[dict | None] = mapped_column(JSON)
    after_data: Mapped[dict | None] = mapped_column(JSON)
    operator_id: Mapped[str | None] = mapped_column(String(255))
    operation_note: Mapped[str | None] = mapped_column(Text)
    changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
