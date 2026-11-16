import { beforeEach, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ slots: [], cursor: 0, context: {},
  remove: vi.fn(), update: vi.fn(), create: vi.fn(), info: vi.fn(), select: vi.fn() }));
vi.mock("react", async (original) => ({
  ...(await original()),
  useState(initial) {
    const index = harness.cursor++;
    if (!(index in harness.slots)) harness.slots[index] = typeof initial === "function" ? initial() : initial;
    return [harness.slots[index], value => {
      harness.slots[index] = typeof value === "function" ? value(harness.slots[index]) : value;
    }];
  },
}));
vi.mock("../src/workbench/WorkbenchContext.jsx", () => ({ useWorkbench: () => harness.context }));
vi.mock("../src/workbench/api.js", () => ({
  deletePlanningVersion: (...args) => harness.remove(...args),
  updatePlanningVersion: (...args) => harness.update(...args),
  createPlanningVersion: (...args) => harness.create(...args),
  planningVersionDeletionInfo: (...args) => harness.info(...args),
  setPlanningVersion: (...args) => harness.select(...args),
}));
import { PlanningVersionsPage } from "../src/workbench/pages/PlanningVersionsPage.jsx";

function render() { harness.cursor = 0; return PlanningVersionsPage(); }
function find(node, predicate) {
  if (Array.isArray(node)) return node.map(child => find(child, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;
  return find(node.props?.children, predicate);
}
const current = { id: "202701", name: "Current", revision: 3, open: false, published: true };
const other = { id: "202702", name: "Other", revision: 1, open: false, published: false };
beforeEach(() => {
  harness.slots = [];
  harness.context = { state: { currentVersionId: current.id, planningVersion: current, planningVersions: [current, other], initiatives: [] },
    apiMode: true, previewMode: false, refresh: vi.fn().mockResolvedValue(true),
    refreshPlanningVersions: vi.fn().mockResolvedValue(true), notify: vi.fn() };
  harness.remove.mockReset().mockResolvedValue({ deleted: true });
  harness.update.mockReset().mockResolvedValue(other);
  harness.create.mockReset().mockResolvedValue(other);
  harness.info.mockReset().mockResolvedValue({ canDelete: true, revision: 1, submittedCount: 0 });
  harness.select.mockReset();
});

it("deletes an unloaded version without reloading the current allocation workspace", async () => {
  const row = find(render(), node => node.key === other.id);
  await find(row, node => node.props?.children === "删除").props.onClick();
  await find(render(), node => node.props?.title === "确认删除规划版本").props.onConfirm();
  expect(harness.remove).toHaveBeenCalledWith(other.id, { expected_revision: 1, confirm_submitted: false });
  expect(harness.context.refreshPlanningVersions).toHaveBeenCalledTimes(1);
  expect(harness.context.refresh).not.toHaveBeenCalled();
  expect(harness.select).not.toHaveBeenCalled();
});

it("reloads a replacement workspace after deleting the selected version", async () => {
  const row = find(render(), node => node.key === current.id);
  await find(row, node => node.props?.children === "删除").props.onClick();
  await find(render(), node => node.props?.title === "确认删除规划版本").props.onConfirm();
  expect(harness.context.refresh).toHaveBeenCalledWith({ preservePage: true });
  expect(harness.context.refreshPlanningVersions).not.toHaveBeenCalled();
  expect(harness.select).toHaveBeenCalledWith("");
});

it("preserves creating and selecting the new version before its workspace loads", async () => {
  find(render(), node => node.props?.children === "＋ 创建规划版本").props.onClick();
  find(render(), node => node.props?.placeholder === "例如 202701").props.onChange({ target: { value: "202703" } });
  find(render(), node => node.props?.maxLength === "100").props.onChange({ target: { value: "New" } });
  await find(render(), node => node.props?.title === "创建规划版本").props.onConfirm();
  expect(harness.create).toHaveBeenCalledWith({ id: "202703", name: "New", source_version_id: current.id });
  expect(harness.select).toHaveBeenCalledWith("202703");
  expect(harness.context.refresh).toHaveBeenCalledWith({ preservePage: true });
});

it("reports metadata refresh failure after a successful mutation", async () => {
  harness.context.refreshPlanningVersions.mockResolvedValue(false);
  const row = find(render(), node => node.key === other.id);
  find(row, node => node.props?.children === "发布并开放").props.onClick();
  await find(render(), node => node.props?.title === "发布并开放 · Other").props.onConfirm();
  expect(harness.context.notify).toHaveBeenCalledWith(expect.stringContaining("刷新失败"), true);
  expect(harness.context.notify).not.toHaveBeenCalledWith("规划版本已保存。");
});
