import hashlib
import json
from collections.abc import Mapping


def dealer_identity(row: Mapping) -> str:
    code = str(row["distributor_code"])
    # Keep legacy identities for records that have no organization information.
    if not row.get("sd") and not row.get("rsm"):
        return code
    key = [row.get("sector"), code, row.get("sd"), row.get("rsm")]
    return (
        "history:"
        + hashlib.sha256(
            json.dumps(key, ensure_ascii=False, separators=(",", ":")).encode()
        ).hexdigest()
    )
