"""Ensure JSON defaults survive Alembic's actual PostgreSQL DDL compiler."""

import importlib.util
import io
import json
import re
from pathlib import Path
from unittest.mock import patch

from alembic.migration import MigrationContext
from alembic.operations import Operations


def test_history_defaults_compile_as_valid_json():
    path = (
        Path(__file__).resolve().parents[1]
        / "migrations/versions/20261114_03_history_affiliation.py"
    )
    spec = importlib.util.spec_from_file_location("v19_history_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    output = io.StringIO()
    context = MigrationContext.configure(
        url="postgresql://", opts={"as_sql": True, "output_buffer": output}
    )
    with patch.object(module, "op", Operations(context)):
        module.upgrade()
    defaults = re.findall(r"JSON DEFAULT '([^']+)'", output.getvalue())
    assert len(defaults) == 2
    roles, thresholds = map(json.loads, defaults)
    assert roles["admin"] == ["MRD", "SP&A", "ICE Rebate", "Capex"]
    assert thresholds == {
        "concentrationYellow": 5,
        "concentrationRed": 10,
        "dealerYellow": 3,
        "dealerRed": 6,
    }
