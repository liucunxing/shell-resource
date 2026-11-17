import { afterEach, describe, expect, it, vi } from "vitest";
import E from "../src/workbench/domain/engine.js";
import data from "../src/workbench/domain/demo-data.json";
import * as api from "../src/workbench/api.js";
import { reviewStatus } from "../src/workbench/pages/DepartmentReviewPage.jsx";
import { versionStatus } from "../src/workbench/pages/PlanningVersionBar.jsx";
import { AuditPage } from "../src/workbench/pages/AdminStudioPage.jsx";
import { renderToStaticMarkup } from "react-dom/server";

afterEach(() => { api.setPlanningVersion(""); vi.unstubAllGlobals(); });
const success = (value = {}) => ({ ok: true, status: 200, json: async () => ({ code: 200, data: value }) });

describe("V19 persisted workflow client", () => {
  it("renders the server audit actor object and recorded reason", () => {
    const html = renderToStaticMarkup(<AuditPage audit={[{ id: "1", actor: { label: "owner@example.test" }, object: "Initiative 22", detail: "核对后退回", action: "RETURN" }]} />);
    expect(html).toContain("owner@example.test"); expect(html).toContain("核对后退回"); expect(html).toContain("Initiative 22");
  });
  it("keeps workspace selection independent of the two-version comparison read", async () => {
    const fetch = vi.fn().mockResolvedValue(success()); vi.stubGlobal("fetch", fetch);
    api.setPlanningVersion("202702");
    await api.workspace(); await api.workspace("202701"); await api.workspace();
    expect(fetch.mock.calls.map(([url]) => new URL(url, "http://local.test").searchParams.get("version_id"))).toEqual(["202702", "202701", "202702"]);
  });
  it("persists this version's change reason together with a draft", async () => {
    const fetch = vi.fn().mockResolvedValue(success()); vi.stubGlobal("fetch", fetch);
    await api.saveDraft("22", { revision: 3, rows: [], otherBudgets: [], changeReason: "核对名单后调整" }, 3);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ expected_revision: 3, changeReason: "核对名单后调整" });
  });
  it("withdraws the complete department using the explicit version revision", async () => {
    const fetch = vi.fn().mockResolvedValue(success()); vi.stubGlobal("fetch", fetch);
    await api.reviewDepartment("202702", "withdraw", { sector: "PCMO", department: "MKT", expected_revision: 9, reason: "核对部门方案" });
    expect(fetch.mock.calls[0][0]).toBe("/api/v1/workbench/planning-versions/202702/department/withdraw");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ sector: "PCMO", department: "MKT", expected_revision: 9, reason: "核对部门方案" });
  });
  it("honors server read-only state even for the correctly assigned Owner", () => {
    const state = E.createState(data, "working"), item = state.initiatives[0];
    const identity = { role: "owner", department: item.department, ownerId: item.ownerId };
    item.workflow = { submitted: true, editable: false };
    expect(E.canEdit(state, item.id, identity)).toBe(false);
    expect(() => E.updateInitiative(state, item.id, { rows: [] }, identity, data)).toThrow();
    item.workflow = { submitted: false, editable: true, requiresResubmission: true };
    expect(E.canEdit(state, item.id, identity)).toBe(true);
    expect(E.canEdit(state, item.id, { ...identity, preview: { readOnly: true } })).toBe(false);
  });
  it("accepts a fixed enabled reserve reason without free text and rejects a retired reason", () => {
    const state = E.createState(data, "working"), item = state.initiatives[0];
    item.workflow = { editable: true };
    item.rows = [];
    item.otherBudgets = [{ id: "reserve-row", reasonId: state.budgetReasons[0].id, amount: item.budget, note: "" }];
    expect(E.completionErrors(item, data, state.budgetReasons)).toEqual([]);
    state.budgetReasons[0].enabled = false;
    expect(E.completionErrors(item, data, state.budgetReasons).join(" ")).toContain("已停用");
  });
  it("does not turn withdrawal of confirmation into an Owner return", () => {
    expect(reviewStatus({ workflow: { submitted: true, confirmed: false } })).toBe("已提交");
    expect(reviewStatus({ workflow: { submitted: false, requiresResubmission: true } })).toBe("待重新提交");
  });
  it("shows expired deadlines without claiming the version remains open", () => {
    expect(versionStatus({ published: true, open: true, deadline: "2000-01-01T00:00:00Z" })).toBe("开放提交");
    expect(versionStatus({ published: false, open: false })).toBe("未开始");
  });
});
