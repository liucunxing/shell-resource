import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DepartmentReviewPage, departmentWindowOpen } from "../src/workbench/pages/DepartmentReviewPage.jsx";
import { useWorkbench } from "../src/workbench/WorkbenchContext.jsx";
import * as api from "../src/workbench/api.js";

vi.mock("../src/workbench/WorkbenchContext.jsx", () => ({ useWorkbench: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); });
const version = { id: "202701", name: "年度规划", published: true, open: true, revision: 4, deadline: "2026-11-17T07:00:00Z" };

describe("department withdrawal and administrator release", () => {
  it("requires an open version and ignores old deadline values", () => {
    expect(departmentWindowOpen(version)).toBe(true);
    expect(departmentWindowOpen({ ...version, open: false })).toBe(false);
    expect(departmentWindowOpen({ ...version, published: false })).toBe(false);
    expect(departmentWindowOpen({ ...version, deadline: "2000-01-01T00:00:00Z", expired: true })).toBe(true);
  });
  it("sends release at version scope with no department or Owner selection", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ code: 200, data: {} }) });
    vi.stubGlobal("fetch", fetch);
    const command = { expected_revision: 4, reason: "重新核对" };
    await api.releasePlanningVersion("202701", command);
    expect(fetch.mock.calls[0][0]).toBe("/api/v1/workbench/planning-versions/202701/release");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(command);
  });
  it("shows the global release action even after closing and removes all targeted Owner return controls", () => {
    useWorkbench.mockReturnValue({ state: { planningVersion: { ...version, open: false }, planningVersions: [version], initiatives: [{ sector: "PCMO", department: "MKT" }] }, identity: { role: "admin" }, apiMode: true, previewMode: false });
    const html = renderToStaticMarkup(<DepartmentReviewPage />);
    expect(html).toContain("驳回并开放全部部门");
    expect(html).toContain("不受查看范围限制");
    expect(html).not.toMatch(/disabled=""[^>]*>驳回并开放全部部门/);
    expect(html).not.toContain("退回该 Owner");
    expect(html).not.toContain("退回该 Initiative");
    expect(html).not.toContain("按 Owner 开放修改");
  });
  it("keeps release unavailable to read-only administrator previews", () => {
    useWorkbench.mockReturnValue({ state: { planningVersion: version, planningVersions: [version], initiatives: [] }, identity: { role: "admin" }, apiMode: true, previewMode: true });
    expect(renderToStaticMarkup(<DepartmentReviewPage />)).toMatch(/disabled=""[^>]*>驳回并开放全部部门/);
  });
});
