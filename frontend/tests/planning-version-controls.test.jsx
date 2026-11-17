import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  beijingDeadlineInput,
  deadlineUpdate,
  displayVersionOrder,
  PlanningVersionsPage,
  versionSummary,
} from "../src/workbench/pages/PlanningVersionsPage.jsx";
import { useWorkbench } from "../src/workbench/WorkbenchContext.jsx";
import { PlanningVersionBar, versionStatus } from "../src/workbench/pages/PlanningVersionBar.jsx";

vi.mock("../src/workbench/WorkbenchContext.jsx", () => ({
  useWorkbench: vi.fn(),
}));

const current = {
  id: "202702",
  name: "第二版",
  createdBy: "admin@example.com",
  published: true,
  open: true,
  revision: 5,
  deadline: "2026-12-01T09:30:00Z",
};

describe("V19 version table and deadlines", () => {
  it("displays real version IDs oldest first without changing the source selector order", () => {
    const versions = [{ id: "202703" }, { id: "202701" }, { id: "202702" }];
    expect(displayVersionOrder(versions).map((version) => version.id)).toEqual(["202701", "202702", "202703"]);
    expect(versions.map((version) => version.id)).toEqual(["202703", "202701", "202702"]);
  });
  it("counts only enabled current-version budgets and does not invent unloaded totals", () => {
    const state = {
      currentVersionId: "202702",
      initiatives: [
        { budget: 100000 },
        { budget: 50000, enabled: false },
        { budget: 20000 },
      ],
    };
    expect(versionSummary(current, state)).toEqual({
      count: 2,
      budget: 120000,
    });
    expect(versionSummary({ id: "202701" }, state)).toBeNull();
    expect(
      versionSummary(current, { ...state, initiatives: [{ budget: null }] }),
    ).toEqual({ count: 1, budget: null });
  });
  it("uses Beijing time independent of browser timezone and clears without reopening", () => {
    expect(beijingDeadlineInput(current.deadline)).toBe("2026-12-01T17:30");
    expect(deadlineUpdate(current, "2026-12-01T17:30", 0)).toEqual({
      expected_revision: 5,
      deadline: current.deadline.replace("Z", ".000Z"),
    });
    expect(deadlineUpdate({ ...current, open: false }, "")).toEqual({
      expected_revision: 5,
      deadline: null,
    });
  });
  it("keeps expiry separate from the administrator deactivating a version", () => {
    expect(
      deadlineUpdate(
        current,
        "2026-11-01T08:00",
        Date.parse("2026-11-14T00:00:00Z"),
      ),
    ).toEqual({
      expected_revision: 5,
      deadline: "2026-11-01T00:00:00.000Z",
    });
  });
  it("distinguishes unpublished, inactive and expired versions without losing publication state", () => {
    expect(versionStatus({ ...current, published: false })).toBe("未发布");
    expect(versionStatus({ ...current, open: false })).toBe("已停用");
    expect(versionStatus({ ...current, deadline: "2000-01-01T00:00:00Z" })).toBe("已截止");
    expect(versionStatus({ ...current, deadline: null })).toBe("开放提交");
  });
  it("renders creators and deadlines in the version table with read-only preview controls", () => {
    useWorkbench.mockReturnValue({
      state: {
        planningVersions: [
          current,
          {
            id: "202701",
            name: "第一版",
            published: true,
                  revision: 3,
          },
        ],
        currentVersionId: current.id,
        initiatives: [{ budget: 100000 }],
      },
      previewMode: true,
      apiMode: true,
    });
    const html = renderToStaticMarkup(<PlanningVersionsPage />);
    expect(html).toContain("启用 Initiative");
    expect(html).toContain("预算合计（万）");
    expect(html).toContain("提交截止时间");
    expect(html).toContain("admin@example.com");
    expect(html).not.toContain("<h2>提交截止时间</h2>");
    expect(html).toContain("2026-12-01 17:30");
    expect(html).not.toContain("撤回发布");
    expect(html).toContain(">停用</button>");
    expect(html).toContain(">重新发布</button>");
    expect(html).toContain("同时仅一个版本开放提交");
    expect(html).not.toContain("所有部门提交齐全后才能关闭");
    expect(html).not.toContain('type="datetime-local"');
    expect(html).not.toContain(">保存</button>");
    expect(html).toMatch(/data-variant="destructive"[^>]*disabled=""[^>]*>删除/);
  });

  it("shows the selected version's Beijing deadline to owner and lead", () => {
    for (const role of ["owner", "lead"]) {
      useWorkbench.mockReturnValue({ state: { planningVersion: current, planningVersions: [current] }, identity: { role }, apiMode: true });
      expect(renderToStaticMarkup(<PlanningVersionBar />)).toContain("提交截止时间：2026-12-01 17:30（北京时间）");
      useWorkbench.mockReturnValue({ state: { planningVersion: { ...current, deadline: null }, planningVersions: [] }, identity: { role }, apiMode: true });
      expect(renderToStaticMarkup(<PlanningVersionBar />)).toContain("提交截止时间：未设置（北京时间）");
    }
  });
});
