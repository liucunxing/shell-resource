"""Default historical columns; administrators can replace the department mapping."""

RESOURCE_TYPES = ("MRD", "SP&A", "ICE Rebate", "Capex")


def default_department_resources() -> dict[str, list[str]]:
    return {"MKT": ["MRD", "SP&A"], "ICE": ["ICE Rebate", "SP&A"], "CAPEX": ["Capex"]}
