import { beforeEach, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ slots: [], cursor: 0, effects: [], context: {},
  list: vi.fn(), update: vi.fn() }));
vi.mock("react", async (original) => ({
  ...(await original()),
  useRef(initial) { return (harness.slots[harness.cursor++] ??= { current: initial }); },
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
  listAdminUsers: (...args) => harness.list(...args),
  updateAdminUser: (...args) => harness.update(...args),
}));
import { AdminUsersPanel } from "../src/workbench/pages/AdminUsersPanel.jsx";

function render() {
  harness.cursor = 0;
  const tree = AdminUsersPanel();
  for (const effect of harness.effects.splice(0)) effect();
  return tree;
}
function find(node, predicate) {
  if (Array.isArray(node)) return node.map(child => find(child, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;
  return find(node.props?.children, predicate);
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const user = { id: 7, email: "owner@example.test", display_name: "Owner", role: "owner",
  department: ["MKT"], sector: ["B2B"], affiliation_sector: "B2B", affiliation_department: "MKT", enabled: true };
beforeEach(() => {
  harness.slots = []; harness.effects = [];
  harness.context = { identity: { role: "admin", email: "admin@example.test" }, state: { initiatives: [] }, data: {},
    roles: [], loading: false, notify: vi.fn(), refresh: vi.fn() };
  harness.list.mockReset().mockResolvedValue({ items: [user], total: 1, lead_sectors_by_department: { MKT: ["B2B"] } });
  harness.update.mockReset().mockResolvedValue(user);
});

it("coalesces the user list reload until the saved workspace permissions finish refreshing", async () => {
  render(); await flush();
  find(render(), node => node.props?.children === "编辑").props.onClick();
  let finish;
  harness.context.refresh.mockImplementation(() => {
    harness.context.loading = true;
    return new Promise(resolve => { finish = () => {
      harness.context.loading = false;
      harness.context.roles = [{ email: user.email }];
      resolve(true);
    }; });
  });
  const saving = find(render(), node => node.props?.title === "修改人员").props.onConfirm();
  await flush();
  render();
  expect(harness.update).toHaveBeenCalledTimes(1);
  expect(find(render(), node => node.props?.title === "修改人员").props.saving).toBe(true);
  expect(harness.context.refresh).toHaveBeenCalledWith({ preservePage: true });
  expect(harness.list).toHaveBeenCalledTimes(1);
  expect(harness.context.notify).not.toHaveBeenCalled();
  finish(); await saving;
  const finished = render(); await flush();
  expect(find(finished, node => node.props?.title === "修改人员")).toBeFalsy();
  expect(harness.list).toHaveBeenCalledTimes(2);
  expect(harness.context.notify).toHaveBeenCalledExactlyOnceWith("人员修改成功。");
});

it("retains list errors after a refresh rather than showing a successful empty list", async () => {
  harness.context.loading = true;
  render();
  expect(harness.list).not.toHaveBeenCalled();
  harness.list.mockRejectedValueOnce(new Error("人员权限查询失败"));
  harness.context.loading = false;
  render(); await flush();
  const error = find(render(), node => Array.isArray(node.props?.children) && node.props.children.includes("人员权限查询失败"));
  expect(error).toBeTruthy();
});

it("saves only changed project assignments against the version opened for editing", async () => {
  harness.context.state.planningVersion = { id: "202702", revision: 5 };
  harness.context.state.initiatives = [
    { id: "1", name: "原项目", ownerId: user.email },
    { id: "2", name: "新项目", ownerId: "other@example.test" },
  ];
  render(); await flush();
  find(render(), node => node.props?.children === "编辑").props.onClick();
  const picker = find(render(), node => node.props?.owned instanceof Set);
  expect([...picker.props.owned]).toEqual(["1"]);
  picker.props.onChange({ 1: "", 2: true });
  await find(render(), node => node.props?.title === "修改人员").props.onConfirm();
  expect(harness.update).not.toHaveBeenCalled();
  picker.props.onChange({ 1: "other@example.test", 2: true });
  harness.context.state.planningVersion = { id: "202703", revision: 1 };
  await find(render(), node => node.props?.title === "修改人员").props.onConfirm();
  expect(harness.update).toHaveBeenCalledWith(user.id, expect.objectContaining({
    assignments: { version_id: "202702", expected_revision: 5, transfers: [
      { budget_id: 1, owner_email: "other@example.test" },
      { budget_id: 2, owner_email: user.email },
    ] },
  }));
});
