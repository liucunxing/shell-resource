"""Run live RBAC acceptance checks against the local Shell Forecast API.

This runner intentionally targets only [RBAC-TEST] data. It performs several
reversible/no-op writes and may add publications/revisions to a test Initiative.
The raw evidence JSON is suitable for attaching to the acceptance report.
"""

from __future__ import annotations

import argparse
import json
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import requests
from openpyxl import Workbook


USERS = {
    "owner_a": "sf-owner-a@example.test",
    "owner_b": "sf-owner-b@example.test",
    "ice_owner": "sf-ice-owner@example.test",
    "lead": "sf-mkt-lead@example.test",
    "management": "sf-management@example.test",
    "admin": "sf-admin@example.test",
}


class Runner:
    def __init__(self, base_url: str) -> None:
        self.base = base_url.rstrip("/")
        self.api = self.base + "/api/v1/workbench"
        self.results: list[dict[str, Any]] = []

    def _record(
        self,
        case: str,
        purpose: str,
        expected: str,
        actual: str,
        passed: bool,
        *,
        role: str = "system",
        method: str = "CHECK",
        path: str = "-",
    ) -> None:
        self.results.append(
            {
                "case": case,
                "purpose": purpose,
                "role": role,
                "method": method,
                "path": path,
                "expected": expected,
                "actual": actual,
                "result": "PASS" if passed else "FAIL",
            }
        )

    def request(
        self,
        case: str,
        purpose: str,
        method: str,
        path: str,
        role: str | None,
        expected_status: int | set[int],
        **kwargs: Any,
    ) -> tuple[requests.Response, Any]:
        headers = dict(kwargs.pop("headers", {}))
        if role:
            headers["X-User-Email"] = USERS.get(role, role)
        response = requests.request(
            method,
            self.base + path,
            headers=headers,
            timeout=30,
            **kwargs,
        )
        try:
            body = response.json()
        except ValueError:
            body = response.content
        statuses = expected_status if isinstance(expected_status, set) else {expected_status}
        detail = body
        if isinstance(body, dict):
            detail = body.get("detail") or body.get("msg") or body.get("data")
        actual = f"HTTP {response.status_code}; {str(detail)[:400]}"
        self._record(
            case,
            purpose,
            "/".join(str(item) for item in sorted(statuses)),
            actual,
            response.status_code in statuses,
            role=role or "anonymous",
            method=method,
            path=path,
        )
        return response, body

    def check(
        self,
        case: str,
        purpose: str,
        expected: str,
        actual: Any,
        passed: bool,
        role: str,
        path: str = "/api/v1/workbench/workspace",
    ) -> None:
        self._record(
            case,
            purpose,
            expected,
            str(actual)[:800],
            passed,
            role=role,
            method="ASSERT",
            path=path,
        )

    @staticmethod
    def data(body: Any) -> Any:
        return body.get("data") if isinstance(body, dict) else None


def initiative_total(item: dict[str, Any]) -> float:
    return sum(float(row["amount"]) for row in item.get("rows", [])) + sum(
        float(row["amount"]) for row in item.get("otherBudgets", [])
    )


def detailed_dealers(workspace: dict[str, Any]) -> set[str]:
    return {
        str(dealer["id"])
        for dealer in workspace["data"]["dealers"]
        if dealer.get("history")
    }


def allocated_dealers(workspace: dict[str, Any]) -> set[str]:
    return {
        str(row["dealerId"])
        for item in workspace["state"]["initiatives"]
        for row in item.get("rows", [])
    }


def draft_payload(draft: dict[str, Any], revision: int | None = None) -> dict[str, Any]:
    return {
        "expected_revision": draft["revision"] if revision is None else revision,
        "rows": draft.get("rows", []),
        "otherBudgets": draft.get("otherBudgets", []),
    }


def run(base_url: str) -> dict[str, Any]:
    t = Runner(base_url)
    started = datetime.now(UTC).isoformat()

    t.request("SYS-01", "证明后端健康检查可用", "GET", "/health", None, 200)
    t.request("SYS-02", "证明 Swagger 页面可访问", "GET", "/docs", None, 200)
    _, openapi_body = t.request(
        "SYS-03", "证明 OpenAPI 契约可读取", "GET", "/openapi.json", None, 200
    )
    path_count = len(openapi_body.get("paths", {})) if isinstance(openapi_body, dict) else 0
    t.check("SYS-04", "确认工作台端点已注册", "至少 15 个端点", path_count, path_count >= 15, "system", "/openapi.json")

    t.request(
        "AUTH-01",
        "证明缺少开发身份头不能访问业务接口",
        "GET",
        "/api/v1/workbench/workspace?planning_year=2027",
        None,
        401,
    )
    t.request(
        "AUTH-02",
        "证明未知邮箱不能伪造有效身份",
        "GET",
        "/api/v1/workbench/workspace?planning_year=2027",
        "missing-rbac-user@example.test",
        403,
    )

    workspaces: dict[str, dict[str, Any]] = {}
    for role in USERS:
        _, body = t.request(
            f"WS-{role.upper()}",
            f"读取 {role} 的服务端工作台投影",
            "GET",
            "/api/v1/workbench/workspace?planning_year=2027",
            role,
            200,
        )
        workspaces[role] = t.data(body)

    for role in ("owner_a", "owner_b", "ice_owner"):
        workspace = workspaces[role]
        items = workspace["state"]["initiatives"]
        email = USERS[role]
        t.check(
            f"SCOPE-{role.upper()}",
            "证明 Owner 只能看到当前归属给自己的 Initiative",
            f"所有 ownerId 均为 {email}",
            [(item["id"], item["ownerId"], item["name"]) for item in items],
            bool(items) and all(item["ownerId"] == email for item in items),
            role,
        )
        details = detailed_dealers(workspace)
        allocations = allocated_dealers(workspace)
        t.check(
            f"REF-{role.upper()}",
            "证明 Owner 的详细历史仅覆盖本人项目涉及经销商；目录项可以无历史值",
            "有历史值的经销商集合不超出本人分配集合",
            {"detailed": len(details), "allocated": len(allocations), "extra": sorted(details - allocations)},
            details.issubset(allocations),
            role,
        )

    lead = workspaces["lead"]
    lead_items = lead["state"]["initiatives"]
    t.check(
        "SCOPE-LEAD",
        "证明部门负责人只能读取 MKT 部门工作稿，不按 Initiative Sector 过滤",
        "所有项目均为 MKT 部门",
        [(item["id"], item["department"], item["sector"], item["ownerId"]) for item in lead_items],
        bool(lead_items)
        and all(item["department"] == "MKT" for item in lead_items),
        "lead",
    )
    lead_details = detailed_dealers(lead)
    lead_allocations = allocated_dealers(lead)
    t.check(
        "REF-LEAD",
        "证明 Lead 的详细历史限制在本部门项目涉及的经销商",
        "有历史值的经销商集合不超出 MKT 项目分配集合",
        {
            "detailed": len(lead_details),
            "allocated": len(lead_allocations),
            "extra_count": len(lead_details - lead_allocations),
        },
        lead_details.issubset(lead_allocations),
        "lead",
    )

    management = workspaces["management"]
    management_items = management["state"]["initiatives"]
    t.check(
        "SCOPE-MANAGEMENT",
        "证明管理层工作台只包含已同步快照",
        "所有项目均有 publishedAt/publishedRevision",
        [
            (item["id"], item["name"], item["publishedRevision"], item["publishedAt"])
            for item in management_items
        ],
        bool(management_items)
        and all(item.get("publishedAt") and item.get("publishedRevision") is not None for item in management_items),
        "management",
    )
    t.check(
        "LOG-MANAGEMENT",
        "证明管理层当前不返回操作日志",
        "audit=[]",
        management["state"]["audit"],
        management["state"]["audit"] == [],
        "management",
    )

    admin = workspaces["admin"]
    admin_items = admin["state"]["initiatives"]
    t.check(
        "SCOPE-ADMIN",
        "证明管理员能看全部配置但看不到业务分配明细",
        "四个以上配置项目且 rows/otherBudgets 全为空",
        [(item["id"], item["name"], len(item["rows"]), len(item["otherBudgets"])) for item in admin_items],
        len(admin_items) >= 4
        and all(not item.get("rows") and not item.get("otherBudgets") for item in admin_items),
        "admin",
    )
    t.check(
        "USERS-ADMIN",
        "证明仅管理员工作台下发人员权限配置",
        "管理员有 users，其他角色 users 为空",
        {role: len(workspaces[role]["users"]) for role in workspaces},
        bool(admin["users"])
        and all(not workspaces[role]["users"] for role in workspaces if role != "admin"),
        "admin",
    )

    owner_workspace = workspaces["owner_a"]
    owner_role = "owner_a"
    if not owner_workspace["state"]["initiatives"]:
        owner_workspace = workspaces["owner_b"]
        owner_role = "owner_b"
    balanced = [
        item
        for item in owner_workspace["state"]["initiatives"]
        if abs(initiative_total(item) - float(item["budget"])) < 0.001
    ]
    target = balanced[0] if balanced else owner_workspace["state"]["initiatives"][0]
    budget_id = int(target["id"])
    other_owner = "owner_b" if owner_role == "owner_a" else "owner_a"

    _, draft_body = t.request(
        "DRAFT-OWNER-READ",
        "证明 Owner 可读取本人项目草稿",
        "GET",
        f"/api/v1/workbench/initiatives/{budget_id}/draft",
        owner_role,
        200,
    )
    draft = t.data(draft_body)
    payload = draft_payload(draft)
    for role, status in ((other_owner, 404), ("lead", 200), ("management", 403), ("admin", 403)):
        t.request(
            f"DRAFT-READ-{role.upper()}",
            f"验证 {role} 对目标草稿的读取边界",
            "GET",
            f"/api/v1/workbench/initiatives/{budget_id}/draft",
            role,
            status,
        )
    for role, status in ((other_owner, 404), ("lead", 403), ("management", 403), ("admin", 403)):
        t.request(
            f"DRAFT-WRITE-{role.upper()}",
            f"证明 {role} 不能代替 Owner 保存目标草稿",
            "PUT",
            f"/api/v1/workbench/initiatives/{budget_id}/draft",
            role,
            status,
            json=payload,
        )

    old_revision = draft["revision"]
    _, saved_body = t.request(
        "DRAFT-OWNER-WRITE",
        "证明 Owner 可整项保存本人草稿",
        "PUT",
        f"/api/v1/workbench/initiatives/{budget_id}/draft",
        owner_role,
        200,
        json=payload,
    )
    draft = t.data(saved_body)
    t.check(
        "DRAFT-REVISION",
        "证明成功保存后 revision 递增",
        f"> {old_revision}",
        draft["revision"],
        draft["revision"] > old_revision,
        owner_role,
        f"/api/v1/workbench/initiatives/{budget_id}/draft",
    )
    t.request(
        "DRAFT-STALE",
        "证明旧 revision 不能覆盖新草稿",
        "PUT",
        f"/api/v1/workbench/initiatives/{budget_id}/draft",
        owner_role,
        409,
        json=payload,
    )

    duplicate = draft_payload(draft)
    duplicate["rows"] = list(duplicate["rows"]) + [dict(duplicate["rows"][0])]
    t.request(
        "DRAFT-DUPLICATE-DEALER",
        "证明重复经销商编码导致整项拒绝",
        "PUT",
        f"/api/v1/workbench/initiatives/{budget_id}/draft",
        owner_role,
        422,
        json=duplicate,
    )
    unknown = draft_payload(draft)
    unknown["rows"] = list(unknown["rows"]) + [
        {"dealerId": "RBAC-NOT-EXISTING-DEALER", "amount": 0, "note": "API test"}
    ]
    t.request(
        "DRAFT-UNKNOWN-DEALER",
        "证明未知经销商编码导致整项拒绝",
        "PUT",
        f"/api/v1/workbench/initiatives/{budget_id}/draft",
        owner_role,
        422,
        json=unknown,
    )

    if abs(initiative_total(draft) - float(draft["budget"])) < 0.001:
        _, publish_body = t.request(
            "PUBLISH-OWNER",
            "证明 Owner 可同步已配平的本人项目",
            "POST",
            f"/api/v1/workbench/initiatives/{budget_id}/publish",
            owner_role,
            200,
            json={"expected_revision": draft["revision"], "note": "RBAC API acceptance"},
        )
        publication = t.data(publish_body)
        t.check(
            "PUBLISH-SNAPSHOT",
            "证明同步结果绑定当前 revision 并生成版本号",
            f"publishedRevision={draft['revision']}",
            {
                "number": publication.get("number"),
                "publishedRevision": publication.get("publishedRevision"),
            },
            publication.get("publishedRevision") == draft["revision"],
            owner_role,
            f"/api/v1/workbench/initiatives/{budget_id}/publish",
        )
    else:
        t.check(
            "PUBLISH-OWNER",
            "证明 Owner 可同步已配平的本人项目",
            "存在配平的 Owner 测试项目",
            {"budget": draft["budget"], "total": initiative_total(draft)},
            False,
            owner_role,
        )

    for role, status in ((owner_role, 200), ("lead", 200), ("management", 200), ("admin", 403), (other_owner, 404)):
        t.request(
            f"PUBLICATIONS-{role.upper()}",
            f"验证 {role} 对同步历史的访问边界",
            "GET",
            f"/api/v1/workbench/initiatives/{budget_id}/publications",
            role,
            status,
        )

    # Legacy allocation endpoints: perform a zero-amount create/update/delete so business totals stay unchanged.
    _, latest_workspace_body = t.request(
        "OWNER-REFRESH",
        "刷新 Owner 工作台以选择未使用经销商",
        "GET",
        "/api/v1/workbench/workspace?planning_year=2027",
        owner_role,
        200,
    )
    latest_workspace = t.data(latest_workspace_body)
    used = allocated_dealers(latest_workspace)
    unused = next(dealer["id"] for dealer in latest_workspace["data"]["dealers"] if dealer["id"] not in used)
    _, create_body = t.request(
        "ALLOC-CREATE",
        "证明 Owner 可新增本人项目经销商分配",
        "POST",
        f"/api/v1/workbench/initiatives/{budget_id}/distributor-allocations",
        owner_role,
        200,
        json={"distributor_code": unused, "distributor_budget_amount": 0, "description": "RBAC API test"},
    )
    allocation = t.data(create_body)
    allocation_id = allocation.get("id") if isinstance(allocation, dict) else None
    if allocation_id:
        t.request(
            "ALLOC-UPDATE",
            "证明 Owner 可修改本人项目经销商分配说明",
            "PATCH",
            f"/api/v1/workbench/initiatives/{budget_id}/distributor-allocations/{allocation_id}",
            owner_role,
            200,
            json={"description": "RBAC API test updated"},
        )
        t.request(
            "ALLOC-DELETE",
            "证明 Owner 可删除本人项目经销商分配并恢复测试数据",
            "DELETE",
            f"/api/v1/workbench/initiatives/{budget_id}/distributor-allocations/{allocation_id}",
            owner_role,
            200,
        )

    for role, status in (("lead", 403), ("management", 403), ("admin", 403)):
        t.request(
            f"ALLOC-CREATE-{role.upper()}",
            f"证明 {role} 不能新增业务分配",
            "POST",
            f"/api/v1/workbench/initiatives/{budget_id}/distributor-allocations",
            role,
            status,
            json={"distributor_code": unused, "distributor_budget_amount": 0},
        )

    # Excel endpoint negative and positive checks; delete the imported zero row afterwards.
    t.request(
        "XLS-BAD-TYPE",
        "证明 Owner 上传非 xlsx 文件被拒绝",
        "POST",
        f"/api/v1/workbench/initiatives/{budget_id}/distributor-allocations/import",
        owner_role,
        400,
        files={"file": ("invalid.txt", b"not xlsx", "text/plain")},
    )
    for role, status in (("lead", 403), ("management", 403), ("admin", 403), (other_owner, 404)):
        t.request(
            f"XLS-DENY-{role.upper()}",
            f"证明 {role} 不能向目标项目回传 Excel",
            "POST",
            f"/api/v1/workbench/initiatives/{budget_id}/distributor-allocations/import",
            role,
            status,
            files={"file": ("invalid.txt", b"not xlsx", "text/plain")},
        )
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as temp_file:
        xlsx_path = Path(temp_file.name)
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["distributor_code", "distributor_budget_amount", "description"])
    sheet.append([unused, 0, "RBAC Excel API test"])
    workbook.save(xlsx_path)
    with xlsx_path.open("rb") as handle:
        _, import_body = t.request(
            "XLS-OWNER-IMPORT",
            "证明 Owner 可向本人项目回传合法 Excel",
            "POST",
            f"/api/v1/workbench/initiatives/{budget_id}/distributor-allocations/import",
            owner_role,
            200,
            files={
                "file": (
                    "rbac-api.xlsx",
                    handle,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            },
        )
    xlsx_path.unlink(missing_ok=True)
    if t.data(import_body):
        _, rows_body = t.request(
            "XLS-VERIFY",
            "确认 Excel 数据只写入目标项目",
            "GET",
            f"/api/v1/workbench/initiatives/{budget_id}/distributor-allocations",
            owner_role,
            200,
        )
        imported = next(
            (row for row in t.data(rows_body) if row["distributor_code"] == unused), None
        )
        t.check(
            "XLS-VERIFY-ROW",
            "证明合法 Excel 写入指定经销商",
            f"存在 {unused}",
            imported,
            imported is not None,
            owner_role,
        )
        if imported:
            t.request(
                "XLS-CLEANUP",
                "删除本次 Excel 导入的零金额测试行",
                "DELETE",
                f"/api/v1/workbench/initiatives/{budget_id}/distributor-allocations/{imported['id']}",
                owner_role,
                200,
            )

    # Admin API checks. A no-op update proves the success path without changing business values.
    _, admin_now_body = t.request(
        "ADMIN-REFRESH", "刷新管理员配置", "GET", "/api/v1/workbench/workspace?planning_year=2027", "admin", 200
    )
    admin_now = t.data(admin_now_body)
    admin_target = next(item for item in admin_now["state"]["initiatives"] if int(item["id"]) == budget_id)
    admin_update = {
        "items": [
            {
                "id": budget_id,
                "expected_revision": admin_target["revision"],
                "budget": admin_target["budget"],
                "ownerId": admin_target["ownerId"],
            }
        ]
    }
    t.request(
        "ADMIN-BUDGET-NOOP",
        "证明管理员可维护预算/Owner；使用相同值避免改变业务数据",
        "PUT",
        "/api/v1/workbench/admin/budgets",
        "admin",
        200,
        json=admin_update,
    )
    stale_admin = json.loads(json.dumps(admin_update))
    stale_admin["items"][0]["expected_revision"] = max(0, admin_target["revision"] - 1)
    t.request(
        "ADMIN-BUDGET-STALE",
        "证明管理员旧 revision 不能覆盖预算配置",
        "PUT",
        "/api/v1/workbench/admin/budgets",
        "admin",
        409 if admin_target["revision"] > 0 else 200,
        json=stale_admin,
    )
    t.request(
        "ADMIN-BUDGET-OWNER-DENY",
        "证明 Owner 不能维护预算/Owner",
        "PUT",
        "/api/v1/workbench/admin/budgets",
        owner_role,
        403,
        json=admin_update,
    )

    unique_name = "[RBAC-TEST] API-管理员新增-" + datetime.now(UTC).strftime("%Y%m%d%H%M%S")
    create_budget = {
        "planning_year": 2027,
        "items": [
            {
                "name": unique_name,
                "resourceType": "MRD",
                "sector": "PCMO",
                "department": "MKT",
                "budget": 1,
                "ownerId": USERS["owner_a"],
            }
        ],
    }
    t.request(
        "ADMIN-BUDGET-CREATE",
        "证明管理员可新增预算并分配合法 Owner",
        "POST",
        "/api/v1/workbench/admin/budgets",
        "admin",
        200,
        json=create_budget,
    )
    t.request(
        "ADMIN-BUDGET-DUPLICATE",
        "证明重复业务键不能再次创建",
        "POST",
        "/api/v1/workbench/admin/budgets",
        "admin",
        409,
        json=create_budget,
    )
    invalid_owner = json.loads(json.dumps(create_budget))
    invalid_owner["items"][0]["name"] += "-invalid-owner"
    invalid_owner["items"][0]["ownerId"] = USERS["ice_owner"]
    t.request(
        "ADMIN-BUDGET-INVALID-OWNER",
        "证明管理员不能把 MKT 项目分配给 ICE Owner",
        "POST",
        "/api/v1/workbench/admin/budgets",
        "admin",
        422,
        json=invalid_owner,
    )

    config_revision = admin_now["state"]["configRevision"]
    config_body = {
        "expected_revision": config_revision,
        "guide": admin_now["state"]["guide"],
    }
    t.request(
        "ADMIN-CONFIG-OWNER-DENY",
        "证明非管理员不能维护全局业务指引",
        "PUT",
        "/api/v1/workbench/admin/config",
        owner_role,
        403,
        json=config_body,
    )
    _, config_result = t.request(
        "ADMIN-CONFIG-WRITE",
        "证明管理员可保存全局业务指引并推进配置 revision",
        "PUT",
        "/api/v1/workbench/admin/config",
        "admin",
        200,
        json=config_body,
    )
    new_config_revision = (t.data(config_result) or {}).get("revision", config_revision)
    t.request(
        "ADMIN-CONFIG-STALE",
        "证明旧配置 revision 不能覆盖新配置",
        "PUT",
        "/api/v1/workbench/admin/config",
        "admin",
        409,
        json=config_body,
    )

    reference_payload = {
        "expected_revision": new_config_revision,
        "batchId": "RBAC-NOT-WRITTEN",
        "asOf": "2026",
        "planning_year": 2027,
        "dealers": [{"id": "RBAC-REFERENCE", "history": {}}],
    }
    t.request(
        "REFERENCE-OWNER-DENY",
        "证明非管理员不能导入历史参考批次",
        "POST",
        "/api/v1/workbench/admin/reference",
        owner_role,
        403,
        json=reference_payload,
    )
    stale_reference = dict(reference_payload)
    stale_reference["expected_revision"] = max(0, new_config_revision - 1)
    t.request(
        "REFERENCE-STALE",
        "证明旧配置 revision 不能替换参考批次",
        "POST",
        "/api/v1/workbench/admin/reference",
        "admin",
        409 if new_config_revision > 0 else 200,
        json=stale_reference,
    )

    # Insight read/generate/prompt permissions.
    owner_scope = f"owner:{USERS[owner_role]}"
    insight_cases = [
        ("INSIGHT-OWNER-READ", owner_role, owner_scope, 200),
        ("INSIGHT-OWNER-OTHER", other_owner, owner_scope, 403),
        ("INSIGHT-LEAD-READ", "lead", "MKT", 200),
        ("INSIGHT-LEAD-ICE", "lead", "ICE", 403),
        ("INSIGHT-MANAGEMENT-READ", "management", "global", 200),
        ("INSIGHT-ADMIN-DENY", "admin", "global", 403),
    ]
    insight_bodies: dict[str, Any] = {}
    for case, role, scope, status in insight_cases:
        _, body = t.request(
            case,
            f"验证 {role} 对 Insight scope={scope} 的读取权限",
            "GET",
            f"/api/v1/workbench/insights?scope={requests.utils.quote(scope)}&planning_year=2027",
            role,
            status,
        )
        insight_bodies[case] = t.data(body)
    management_insight = insight_bodies.get("INSIGHT-MANAGEMENT-READ") or {}
    t.check(
        "INSIGHT-MANAGEMENT-PREVIEW",
        "证明管理层拿到同步数据的只读预览",
        "status=preview 且 prompt.editable=false",
        {
            "status": (management_insight.get("record") or {}).get("status"),
            "editable": (management_insight.get("prompt") or {}).get("editable"),
        },
        (management_insight.get("record") or {}).get("status") == "preview"
        and (management_insight.get("prompt") or {}).get("editable") is False,
        "management",
        "/api/v1/workbench/insights",
    )
    for role, status in (("management", 403), ("admin", 403)):
        t.request(
            f"INSIGHT-GENERATE-{role.upper()}",
            f"证明 {role} 不能调用百炼生成 Insight",
            "POST",
            "/api/v1/workbench/insights/generate",
            role,
            status,
            json={"scope": "global", "planning_year": 2027},
        )
    for role, scope in ((owner_role, owner_scope), ("lead", "MKT")):
        t.request(
            f"INSIGHT-GENERATE-{role.upper()}",
            f"证明 {role} 的生成请求能通过 RBAC；502/503 单独表示百炼环境未配置或下游不可用",
            "POST",
            "/api/v1/workbench/insights/generate",
            role,
            {200, 502, 503},
            json={"scope": scope, "planning_year": 2027},
        )

    for role, scope, source_case in (
        (owner_role, owner_scope, "INSIGHT-OWNER-READ"),
        ("lead", "MKT", "INSIGHT-LEAD-READ"),
    ):
        insight = insight_bodies.get(source_case) or {}
        prompt = insight.get("prompt") or {}
        if prompt:
            prompt_payload = {
                "scope": scope,
                "planning_year": 2027,
                "text": prompt["text"],
                "expected_version": prompt["version"],
            }
            t.request(
                f"PROMPT-{role.upper()}-WRITE",
                f"证明 {role} 可维护本人/本部门分析提示词",
                "PUT",
                "/api/v1/workbench/insights/prompt",
                role,
                200,
                json=prompt_payload,
            )
            t.request(
                f"PROMPT-{role.upper()}-STALE",
                f"证明 {role} 的旧提示词版本不能覆盖新版本",
                "PUT",
                "/api/v1/workbench/insights/prompt",
                role,
                409,
                json=prompt_payload,
            )
    for role in ("management", "admin"):
        t.request(
            f"PROMPT-{role.upper()}-DENY",
            f"证明 {role} 不能修改分析提示词",
            "PUT",
            "/api/v1/workbench/insights/prompt",
            role,
            403,
            json={
                "scope": "global",
                "planning_year": 2027,
                "text": "RBAC forbidden prompt",
                "expected_version": 0,
            },
        )

    # Final visibility check: management must see the latest published revision, not later draft-only edits.
    _, final_owner_body = t.request(
        "FINAL-OWNER", "读取最终 Owner 状态", "GET", f"/api/v1/workbench/initiatives/{budget_id}/draft", owner_role, 200
    )
    final_owner = t.data(final_owner_body)
    _, final_management_body = t.request(
        "FINAL-MANAGEMENT", "读取最终管理层工作台", "GET", "/api/v1/workbench/workspace?planning_year=2027", "management", 200
    )
    final_management = t.data(final_management_body)
    management_item = next(
        (item for item in final_management["state"]["initiatives"] if int(item["id"]) == budget_id),
        None,
    )
    t.check(
        "SNAPSHOT-ISOLATION",
        "证明管理层读取的是最新同步快照而不是 Owner 后续未同步 revision",
        "管理层 publishedRevision <= Owner 当前 revision，且快照存在",
        {
            "owner_revision": final_owner["revision"],
            "management_published_revision": management_item.get("publishedRevision") if management_item else None,
        },
        management_item is not None
        and management_item.get("publishedRevision") is not None
        and management_item["publishedRevision"] <= final_owner["revision"],
        "management",
    )

    passed = sum(item["result"] == "PASS" for item in t.results)
    failed = len(t.results) - passed
    return {
        "metadata": {
            "started_at": started,
            "finished_at": datetime.now(UTC).isoformat(),
            "base_url": base_url,
            "planning_year": 2027,
            "target_budget_id": budget_id,
            "target_owner_role": owner_role,
            "created_test_budget_name": unique_name,
            "note": "Frontend acceptance had already changed seed ownership/revisions before this run.",
        },
        "summary": {"total": len(t.results), "passed": passed, "failed": failed},
        "results": t.results,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).with_name("rbac_api_acceptance_evidence.json"),
    )
    args = parser.parse_args()
    evidence = run(args.base_url)
    args.output.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(evidence["summary"], ensure_ascii=False))
    print(args.output.resolve())
    raise SystemExit(1 if evidence["summary"]["failed"] else 0)


if __name__ == "__main__":
    main()
