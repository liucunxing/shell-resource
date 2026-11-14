def distributor_status(value: object) -> str | None:
    """Normalize the data team's 1/0 status without inventing a status for missing data."""
    if value is None:
        return None
    text = str(value).strip().lower()
    return {"1": "active", "0": "closed", "close": "closed"}.get(text, text or None)
