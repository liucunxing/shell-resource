"""Local smoke checks for the opt-in, isolated PostgreSQL acceptance runner.

The shared API flow runs against local SQLite here. Real PostgreSQL ARRAY and
transactional schema rollback remain the separately executed script's checks.
"""

import importlib.util
import json
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "verify_v19_pg.py"
spec = importlib.util.spec_from_file_location("verify_v19_pg", SCRIPT)
assert spec is not None and spec.loader is not None
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


@pytest.mark.asyncio
async def test_isolated_acceptance_api_flow_locally():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    checks = []
    try:
        async with engine.connect() as raw_connection:
            await raw_connection.execute(text("ATTACH DATABASE ':memory:' AS v19_local_fixture"))
            await raw_connection.commit()
            connection = await raw_connection.execution_options(
                schema_translate_map={"data": "v19_local_fixture"}
            )
            async with connection.begin():
                await connection.run_sync(runner.BaseDO.metadata.create_all)
                await runner.check_api(connection, checks)
        assert len(checks) >= 25
        assert all(check["status"] == "passed" for check in checks)
        assert "copy_uses_last_submission_not_later_draft" in {check["id"] for check in checks}
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_acceptance_requires_explicit_configuration_without_connecting(monkeypatch, tmp_path):
    monkeypatch.delenv("APP_SETTINGS_FILE", raising=False)
    report = tmp_path / "missing-settings.json"
    assert await runner.run_acceptance(report) == 1
    payload = json.loads(report.read_text(encoding="utf-8"))
    assert payload["failed_check"] == "explicit_settings_file_required"
    assert payload["cleanup"] == "not_created"


@pytest.mark.asyncio
async def test_acceptance_exception_report_never_contains_exception_details(
    monkeypatch, tmp_path, capsys
):
    def invalid_configuration():
        raise RuntimeError("PRIVATE_DATABASE_PASSWORD")

    monkeypatch.setenv("APP_SETTINGS_FILE", "synthetic-settings.toml")
    monkeypatch.setattr(runner, "get_settings", invalid_configuration)
    report = tmp_path / "invalid-settings.json"
    assert await runner.run_acceptance(report) == 1
    serialized = report.read_text(encoding="utf-8")
    assert json.loads(serialized)["error_type"] == "RuntimeError"
    assert "PRIVATE_DATABASE_PASSWORD" not in serialized + capsys.readouterr().out
