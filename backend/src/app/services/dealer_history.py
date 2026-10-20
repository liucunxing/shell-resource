from collections import defaultdict
from typing import Any


def scoped_dealer_histories(
    records: list[dict[str, Any]], items: list[dict[str, Any]]
) -> dict[str, dict[str, Any]]:
    """Use a dealer's matching sector; ambiguous cross-sector metrics remain unavailable."""
    sectors: dict[str, set[str]] = defaultdict(set)
    for item in items:
        for row in item.get("rows") or []:
            if item.get("sector"):
                sectors[str(row.get("dealerId"))].add(item["sector"])
    candidates: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        code = str(record["id"])
        if not record.get("sector") or not sectors[code] or record["sector"] in sectors[code]:
            candidates[code].append(record)
    return {code: rows[0] for code, rows in candidates.items() if len(rows) == 1}
