from sqlalchemy import Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.models.do.base import BaseDO


class TestTableDO(BaseDO):
    """Read-only mapping for the PostgreSQL data.test_table test table."""

    __tablename__ = "test_table"
    __table_args__ = {"schema": "data"}

    # SQLAlchemy requires an ORM identity column. The test table is read-only in
    # this project, so column_1 is used as its identity for this minimal check.
    column_1: Mapped[int] = mapped_column(Integer, primary_key=True)
