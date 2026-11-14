"""Serialize database timestamps consistently across PostgreSQL and local SQLite."""

from datetime import UTC, datetime


def iso_timestamp(value: datetime | None) -> str | None:
    if value is None:
        return None
    # Database-generated naive timestamps in the local fixture are UTC, not client local time.
    return (value.replace(tzinfo=UTC) if value.tzinfo is None else value).isoformat()
