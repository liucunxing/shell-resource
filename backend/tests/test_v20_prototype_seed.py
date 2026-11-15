"""Verify the V20 preview changes permissions, not the original business snapshot."""

from copy import deepcopy

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from tests.v19_prototype_seed import load_prototype
from tests.v20_prototype_seed import seed_v20_prototype

from app.dependencies.workbench_user import resolve_workbench_permission
from app.models.do import BaseDO
from app.models.do.budget import BudgetDO
from app.services.reference_service import ReferenceService


@pytest.mark.asyncio
@pytest.mark.parametrize("restrict", [False, True])
async def test_v20_fixture_defaults_and_explicit_restrictions_preserve_business_data(restrict):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def attach(connection, _):
        connection.execute("ATTACH DATABASE ':memory:' AS data")

    try:
        async with engine.begin() as connection:
            await connection.run_sync(BaseDO.metadata.create_all)
        prototype = load_prototype()
        if restrict:
            prototype["db"]["historyAccess"]["users"]["U01"] = []
        original = deepcopy(prototype)
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            manifest = await seed_v20_prototype(session, prototype)
            assert prototype == original
            assert await session.scalar(select(func.count()).select_from(BudgetDO)) == 49
            assert [v["budgetCny"] for v in manifest["versions"]] == [51520000, 52220000]
            assert manifest["permissionAdaptation"]["businessValuesChanged"] is False
            for user_id, expected in (
                ("U01", set() if restrict else {"MRD", "SP&A"}),
                ("U02", {"ICE Rebate", "SP&A"}), ("U05", {"Capex"}),
            ):
                user = await resolve_workbench_permission(
                    session, f"v19-{user_id.lower()}@example.test",
                )
                assert user.history_resources == (() if restrict and user_id == "U01" else None)
                rows = await ReferenceService(session).get_dealers(2027, user=user)
                first = next(row for row in rows if row["code"] == "D1001")
                assert set(first["history"]["resources2025"]) == expected
                assert first["history"]["totalInvestment2025"] == 1713437
                assert first["history"]["totalInvestment2026Ytd"] == 1503326
    finally:
        await engine.dispose()
