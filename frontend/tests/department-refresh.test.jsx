import { beforeEach, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ slots: [], cursor: 0, effects: [], context: {}, read: vi.fn(), action: vi.fn() }));
vi.mock("react", async (original) => ({
  ...(await original()),
  useMemo: (fn) => fn(),
  useState(initial) {
    const index = harness.cursor++;
    if (!(index in harness.slots)) harness.slots[index] = typeof initial === "function" ? initial() : initial;
    return [harness.slots[index], value => {
      harness.slots[index] = typeof value === "function" ? value(harness.slots[index]) : value;
    }];
  },
  useEffect(effect, deps) {
    const index = harness.cursor++;
    const previous = harness.slots[index];
    if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
      previous?.cleanup?.();
      const slot = { deps };
      harness.slots[index] = slot;
      harness.effects.push(() => { slot.cleanup = effect(); });
    }
  },
}));
vi.mock("../src/workbench/WorkbenchContext.jsx", () => ({ useWorkbench: () => harness.context }));
vi.mock("../src/workbench/api.js", () => ({
  departmentReview: (...args) => harness.read(...args), reviewDepartment: (...args) => harness.action(...args),
}));
import { DepartmentReviewPage } from "../src/workbench/pages/DepartmentReviewPage.jsx";

function render() {
  harness.cursor = 0;
  const tree = DepartmentReviewPage();
  for (const effect of harness.effects.splice(0)) effect();
  return tree;
}
function find(node, predicate) {
  if (Array.isArray(node)) return node.map(child => find(child, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;
  return find(node.props?.children, predicate);
}
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const version = { id: "202701", revision: 3, published: true, open: true };
beforeEach(() => {
  harness.slots = []; harness.effects = [];
  harness.context = { state: { planningVersion: version, initiatives: [{ sector: "B2B", department: "MKT" }] },
    identity: { role: "lead" }, apiMode: true, previewMode: false, notify: vi.fn(), refresh: vi.fn() };
  harness.read.mockReset().mockResolvedValue({ version, canConfirm: true, items: [] });
  harness.action.mockReset().mockResolvedValue({});
});

it("loads department status once on entry and once after a refreshed mutation", async () => {
  render(); await flush();
  expect(harness.read).toHaveBeenCalledTimes(1);
  find(render(), node => node.props?.children === "提交部门方案至管理层").props.onClick();
  harness.context.refresh.mockImplementation(async () => {
    harness.context.state = { ...harness.context.state, planningVersion: { ...version, revision: 4 } };
    render();
    return true;
  });
  await find(render(), node => typeof node.props?.onConfirm === "function").props.onConfirm();
  await flush();
  expect(harness.action).toHaveBeenCalledTimes(1);
  expect(harness.read).toHaveBeenCalledTimes(2);
});

it("does not issue another status query or report complete success after workspace refresh fails", async () => {
  render(); await flush();
  find(render(), node => node.props?.children === "提交部门方案至管理层").props.onClick();
  harness.context.refresh.mockResolvedValue(false);
  await find(render(), node => typeof node.props?.onConfirm === "function").props.onConfirm();
  expect(harness.read).toHaveBeenCalledTimes(1);
  expect(harness.context.notify).toHaveBeenCalledWith(expect.stringContaining("刷新失败"), true);
});
