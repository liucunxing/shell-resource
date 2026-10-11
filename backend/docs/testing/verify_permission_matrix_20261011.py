"""Reproduce current matrix discrepancies using isolated SQLite and synthetic identities.

Run from backend: .venv/Scripts/python.exe docs/testing/verify_permission_matrix_20261011.py
This is an observation audit, not a declaration that the observed permissions are correct.
No production database, Databricks, or model endpoint is contacted.
"""
import asyncio
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "src"), str(ROOT / "tests")]
os.environ["APP_ENV"] = "test"
os.environ["APP_SETTINGS_FILE"] = str(ROOT / "config/settings.example.toml")

from fastapi import HTTPException
from app.core.config import get_settings
from app.dependencies.workbench_user import WorkbenchUser
from app.models.do.distributor_history import distributor_sellin_resource_history
from app.schemas.dto.workbench import InitiativeDraftUpdateDTO, PublishDTO
from app.services.insight_service import InsightService
from app.services.workspace_service import WorkspaceService
from test_workspace import _session, StubDirectoryService


async def main():
    session = await _session()
    observations = []
    users = {
        "owner": WorkbenchUser("a@example.com", "owner", "MKT", "Owner", ("PCMO",)),
        "lead": WorkbenchUser("lead@example.com", "lead", "MKT", "Lead", ("PCMO",)),
        "management": WorkbenchUser("management@example.com", "management", None, "Management"),
        "admin": WorkbenchUser("admin@example.com", "admin", None, "Admin"),
    }

    async def status(call):
        try:
            await call
            return 200
        except HTTPException as exc:
            return exc.status_code

    try:
        await session.execute(distributor_sellin_resource_history.update().values(
            mrd_2025=7, btl_2025=9, reb_2025=8, capex_2025=10, volume_2025=3
        ))
        await session.commit()
        owner = WorkspaceService(session, users["owner"], StubDirectoryService())
        await owner.save_draft(1, InitiativeDraftUpdateDTO(
            expected_revision=0, rows=[{"dealerId": "d1", "amount": 100}]
        ))
        await owner.publish(1, PublishDTO(expected_revision=1))
        await owner.save_draft(1, InitiativeDraftUpdateDTO(
            expected_revision=1, rows=[{"dealerId": "d1", "amount": 70}]
        ))
        for role, user in users.items():
            service = WorkspaceService(session, user, StubDirectoryService())
            workspace = await service.get_workspace(2027)
            state = workspace["state"]
            observations.append({
                "role": role,
                "initiative_ids": [i["id"] for i in state["initiatives"]],
                "current_allocation": next(i["rows"] for i in state["initiatives"] if i["id"] == "1"),
                "draft_get_status": await status(service.get_draft(1)),
                "publication_get_status": await status(service.publications(1)),
                "history_dealer_ids": [d["id"] for d in workspace["data"]["dealers"]],
                "history_resource_keys": sorted(workspace["data"]["dealers"][0]["history"]["resources2025"]),
                "audit_operations": [i["operation"] for i in state["audit"]],
            })
        by_role = {i["role"]: i for i in observations}
        assert by_role["owner"]["current_allocation"][0]["amount"] == 70
        assert by_role["management"]["current_allocation"][0]["amount"] == 100
        assert by_role["admin"]["current_allocation"] == []
        assert by_role["admin"]["publication_get_status"] == 403
        assert by_role["admin"]["audit_operations"] == []
        assert set(by_role["lead"]["history_resource_keys"]) == {"MRD", "SP&A", "ICE Rebate", "Capex"}
        assert by_role["management"]["history_dealer_ids"] == ["d1"]
        assert by_role["owner"]["history_dealer_ids"] == ["d1", "d2"]
        insight_statuses = {}
        for role, scope in [("management", "global"), ("admin", "global")]:
            service = InsightService(session, users[role], get_settings())
            if role == "management":
                insight_statuses["management_generate"] = await status(service.generate(
                    scope=scope, planning_year=2027
                ))
            insight_statuses[role + "_prompt_update"] = await status(service.update_prompt(
                scope=scope, planning_year=2027, text="audit", expected_version=1
            ))
        assert set(insight_statuses.values()) == {403}
        output = {
            "date": "2026-10-11", "commit": "621b15e2b657fb9f3e6df5c09f2f2cc96423847b",
            "environment": "isolated SQLite; real service queries; synthetic fixtures",
            "observations": observations, "insight_statuses": insight_statuses,
            "matrix_source": "https://bba12hub36.feishu.cn/sheets/HcNusjG8xhAdyctxyA4cXDMDnPb?sheet=1gowPA",
            "matrix_revision": 165,
        }
        path = Path(__file__).with_name("permission_matrix_evidence_20261011.json")
        path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(output, ensure_ascii=False, indent=2))
    finally:
        await session.close()
        await session.bind.dispose()


if __name__ == "__main__":
    asyncio.run(main())
