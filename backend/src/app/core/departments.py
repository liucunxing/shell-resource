"""Normalize legacy single-department values without treating an empty scope as global."""


def departments(value: str | list[str] | tuple[str, ...] | None) -> list[str]:
    if value is None:
        return []
    values = [value] if isinstance(value, str) else value
    return list(dict.fromkeys(item.strip().upper() for item in values if item.strip()))
