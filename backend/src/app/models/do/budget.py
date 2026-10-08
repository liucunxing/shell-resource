from decimal import Decimal

from sqlalchemy import BigInteger, Integer, Numeric, SmallInteger, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.do.base import BaseDO, TimestampMixin


class BudgetDO(TimestampMixin, BaseDO):
    """ORM mapping for the administrator-maintained Initiative budget."""

    __tablename__ = "budgets"
    __table_args__ = {"schema": "data"}

    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    planning_year: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    sector: Mapped[str] = mapped_column(String(32), nullable=False)
    department: Mapped[str] = mapped_column(String(32), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(64), nullable=False)
    initiative_name: Mapped[str] = mapped_column(String(255), nullable=False)
    plan_budget_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    allocate_budget_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    owner_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[int] = mapped_column(Integer, nullable=False)
    input_source: Mapped[str] = mapped_column(String(20), nullable=False)
