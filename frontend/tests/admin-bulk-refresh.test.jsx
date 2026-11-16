import { beforeEach, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ slots: {}, active: "users", cursor: 0, effects: [], context: {},
  list: vi.fn(), importUsers: vi.fn(), preview: vi.fn() }));
vi.mock("react", async (original) => ({
  ...(await original()),
  useState(initial) {
    const slots = harness.slots[harness.active] ||= [];
    const index = harness.cursor++;
    if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
  },
  useRef(initial) {
    const slots = harness.slots[harness.active] ||= [];
    const index = harness.cursor++;
    return slots[index] ??= { current: initial };
  },
  useEffect(effect, deps) {
    const slots = harness.slots[harness.active] ||= [];
    const index = harness.cursor++;
    const previous = slots[index];
    if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
      previous?.cleanup?.();
      const slot = slots[index] = { deps };
      harness.effects.push(() => { slot.cleanup = effect(); });
    }
  },
}));
vi.mock("../src/workbench/WorkbenchContext.jsx", () => ({ useWorkbench: () => harness.context }));
vi.mock("../src/workbench/api.js", () => ({
  listAdminUsers: (...args) => harness.list(...args),
  importAdminUsers: (...args) => harness.importUsers(...args),
}));
vi.mock("../src/workbench/file-import.js", () => ({ previewExcelInWorker: (...args) => harness.preview(...args) }));
import { AdminUsersPanel } from "../src/workbench/pages/AdminUsersPanel.jsx";
import { AdminImportPanel } from "../src/workbench/pages/AdminImportPanel.jsx";

function find(node, predicate) {
  if (Array.isArray(node)) return node.map(child => find(child, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;
  return find(node.props?.children, predicate);
}
function render(name, component) {
  harness.active = name; harness.cursor = 0;
  const tree = component();
  for (const effect of harness.effects.splice(0)) effect();
  return tree;
}
const users = () => render("users", AdminUsersPanel);
const importer = () => {
  const props = find(users(), node => node.type === AdminImportPanel).props;
  return render("import", () => AdminImportPanel(props));
};
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const user = { email: "owner@example.test", display_name: "Owner", role: "owner", department: ["MKT"],
  sector: ["B2B"], affiliation_sector: "B2B", affiliation_department: "MKT", enabled: true };
beforeEach(() => {
  harness.slots = {}; harness.effects = [];
  harness.context = { identity: { role: "admin", email: "admin@example.test" }, state: { initiatives: [] }, data: {},
    roles: [], loading: false, apiMode: true, previewMode: false, notify: vi.fn(), refresh: vi.fn() };
  harness.list.mockReset().mockResolvedValue({ items: [user], total: 1, revision: 5 });
  harness.importUsers.mockReset().mockResolvedValue({ created: 1, updated: 0 });
  harness.preview.mockReset().mockResolvedValue({ items: [user], errors: [], rowNumbers: [2], total: 1 });
});
async function upload() {
  importer(); await flush();
  const file = { name: "users.xlsx", size: 100, arrayBuffer: async () => new ArrayBuffer(0) };
  await find(importer(), node => node.type === "input").props.onChange({ target: { files: [file], value: "users.xlsx" } });
}

it("refreshes the user list only once after bulk import and permission reload", async () => {
  await upload();
  const listRequests = () => harness.list.mock.calls.filter(([, limit]) => limit === 20).length;
  expect(listRequests()).toBe(1);
  harness.context.refresh.mockImplementation(async () => {
    harness.context.loading = true; users();
    harness.context.loading = false;
    harness.context.roles = [user];
    users(); await flush();
    return true;
  });
  await find(importer(), node => node.props?.title === "用户信息导入预览").props.onConfirm();
  users(); await flush();
  expect(harness.importUsers.mock.calls.map(([payload]) => payload.preview)).toEqual([true, false]);
  expect(harness.context.refresh).toHaveBeenCalledTimes(1);
  expect(listRequests()).toBe(2);
});

it("reports saved import with incomplete refresh without retrying the write", async () => {
  await upload();
  harness.context.refresh.mockResolvedValue(false);
  await find(importer(), node => node.props?.title === "用户信息导入预览").props.onConfirm();
  expect(harness.context.notify).toHaveBeenCalledWith(expect.stringContaining("刷新失败"), true);
  expect(harness.importUsers.mock.calls.filter(([payload]) => !payload.preview)).toHaveLength(1);
});
