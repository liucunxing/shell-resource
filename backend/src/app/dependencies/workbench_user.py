from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class WorkbenchUser:
    """Temporary workbench identity until enterprise SSO is available."""

    user_id: str
    user_name: str
    department: str
    sector: str


def get_current_workbench_user() -> WorkbenchUser:
    """Return the agreed fixed development identity for the workbench."""
    return WorkbenchUser(
        user_id="user-a",
        user_name="用户A",
        department="MKT",
        sector="PCMO",
    )
