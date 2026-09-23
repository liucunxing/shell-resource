from decimal import Decimal

from sqlalchemy import BigInteger, Integer, Numeric, SmallInteger, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.do.base import BaseDO, TimestampMixin


class BudgetDistributorDO(TimestampMixin, BaseDO):
    """ORM mapping for one Initiative's distributor-level allocation."""

    __tablename__ = "budgets_distributor"
    __table_args__ = {"schema": "data"}

    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    budget_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    planning_year: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    sector: Mapped[str] = mapped_column(String(32), nullable=False)
    department: Mapped[str] = mapped_column(String(32), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(64), nullable=False)
    initiative_name: Mapped[str] = mapped_column(String(255), nullable=False)
    distributor_code: Mapped[str] = mapped_column(String(255), nullable=False)
    distributor_budget_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    input_source: Mapped[str] = mapped_column(String(20), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
