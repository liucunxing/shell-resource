"""Prepare a fresh test population in memory. Never persist changes to the input files."""

from collections import Counter

ROLE_TO_PROTOTYPE = {"owner": "owner", "lead": "dept", "management": "exec", "admin": "admin"}
ROLE_FROM_PROTOTYPE = {value: key for key, value in ROLE_TO_PROTOTYPE.items()}


def scope(value):
    if not isinstance(value, dict) or not all(
        isinstance(value.get(key), str) and value[key].strip() for key in ("sector", "department")
    ):
        raise ValueError("Each home/scope requires a nonempty sector and department")
    return {"sector": value["sector"].strip(), "dept": value["department"].strip().upper()}


def apply_roster(data, roster):
    """Use aliases only. Source project ownership persists only for IDs explicitly retained."""
    if roster.get("schemaVersion") != 1 or not isinstance(roster.get("users"), list):
        raise ValueError("Roster requires schemaVersion 1 and an explicit users list")
    original_owners = {row["name"]: row["id"] for row in data["db"]["users"]}
    users = {}
    names = set()
    folded_ids = set()
    for row in roster["users"]:
        identifier, name = row["id"], row["name"]
        if not isinstance(identifier, str) or not identifier.isascii() or not identifier.isalnum():
            raise ValueError("Roster IDs must contain only ASCII letters/digits")
        if not isinstance(name, str) or not name.strip() or "@" in name:
            raise ValueError("Use a nonempty display alias, never an email")
        if identifier.lower() in folded_ids or name.strip() in names:
            raise ValueError("Roster IDs and aliases must be unique")
        if type(row.get("enabled")) is not bool or row.get("role") not in ROLE_TO_PROTOTYPE:
            raise ValueError("Invalid roster role or enabled flag")
        if not isinstance(row.get("scopes"), list):
            raise TypeError("Provide an explicit scopes list for every person")
        names.add(name.strip())
        folded_ids.add(identifier.lower())
        users[identifier] = {
            "id": identifier, "name": name.strip(), "role": ROLE_TO_PROTOTYPE[row["role"]],
            "active": row["enabled"], "homeScope": scope(row["home"]),
            "scopes": [scope(item) for item in row["scopes"]],
        }
    admins = [user for user in users.values() if user["active"] and user["role"] == "admin"]
    if not admins:
        raise ValueError("The fixture importer requires an active synthetic administrator")
    assignments = roster.get("projectOwners", {})
    if not isinstance(assignments, dict):
        raise TypeError("projectOwners must map project code to roster ID")
    project_codes = set()
    for version in data["db"]["versions"]:
        for project in version["catalog"]:
            code = project["id"]
            project_codes.add(code)
            owner_id = assignments.get(code, original_owners.get(project["owner"]))
            if owner_id not in users or users[owner_id]["role"] not in {"owner", "dept"}:
                raise ValueError(f"Assign project {code} to an owner or lead in the roster")
            project["owner"] = users[owner_id]["name"]
    if assignments.keys() - project_codes:
        raise ValueError("projectOwners includes unknown project codes")
    data["db"]["users"] = list(users.values())
    data["runtime"]["user"] = admins[0]["id"]
    # A new roster inherits the fixture's departmental history rules. Do not copy personal overrides.
    data["userHistoryAccess"] = [{"id": key, "access": {"fields": []}} for key in users]
    data["db"]["historyAccess"]["users"] = {}


def prepare_open_version(data):
    versions = [v for v in data["db"]["versions"] if v["open"] and v["published"]]
    if len(versions) != 1:
        raise ValueError("The business journey needs exactly one open, published version")
    version = versions[0]
    for field in ("drafts", "submissions"):
        data["db"][field] = {
            key: value for key, value in data["db"][field].items()
            if not key.startswith(version["id"] + "|")
        }
    return version


def population(data, version, budget_ids):
    from tests.v19_prototype_seed import synthetic_email

    people = data["db"]["users"]
    if any(n > 1 for n in Counter(u["name"] for u in people).values()):
        raise ValueError("Fixture user aliases must uniquely identify project owners")
    result = []
    for user in people:
        projects = [
            {"id": budget_ids[p["id"]], "code": p["id"], "name": p["name"], "sector": p["sector"],
             "department": p["dept"].upper(), "budgetCny": int(p["budget"])}
            for p in version["catalog"] if p["enabled"] and p["owner"] == user["name"]
        ]
        scopes = {(s["sector"], s["dept"].upper()) for s in user["scopes"]}
        if user["role"] == "owner":
            scopes.update((p["sector"], p["department"]) for p in projects)
        result.append({
            "id": user["id"], "email": synthetic_email(user), "name": user["name"],
            "role": ROLE_FROM_PROTOTYPE[user["role"]], "enabled": user["active"],
            "scopes": [{"sector": s, "department": d} for s, d in sorted(scopes)],
            "projects": projects,
        })
    return result
