import { beforeEach, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ slots: [], cursor: 0, context: {},
  clear: vi.fn(), remove: vi.fn(), update: vi.fn(), create: vi.fn(), info: vi.fn(), select: vi.fn() }));
vi.mock("react", async (original) => ({
  ...(await original()),
  useState(initial) {
    const index = harness.cursor++;
    if (!(index in harness.slots)) harness.slots[index] = typeof initial === "function" ? initial() : initial;
    return [harness.slots[index], value => {
      harness.slots[index] = typeof value === "function" ? value(harness.slots[index]) : value;
    }];
  },
  useRef(initial) { const index = harness.cursor++; return harness.slots[index] ??= { current: initial }; },
}));
vi.mock("../src/workbench/WorkbenchContext.jsx", () => ({ useWorkbench: () => harness.context }));
vi.mock("../src/workbench/api.js", () => ({
  deletePlanningVersion: (...args) => harness.remove(...args),
  updatePlanningVersion: (...args) => harness.update(...args),
  clearPlanningVersionDrafts: (...args) => harness.clear(...args),
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
  harness.clear.mockReset().mockResolvedValue({ version: current, clearedInitiatives: 2 });
  harness.remove.mockReset().mockResolvedValue({ deleted: true });
  harness.update.mockReset().mockResolvedValue(other);
  harness.create.mockReset().mockResolvedValue(other);
  harness.info.mockReset().mockResolvedValue({ canDelete: true, revision: 1, submittedCount: 0 });
  harness.select.mockReset();
});

it("deletes an unloaded version without reloading the current allocation workspace", async () => {
  const row = find(render(), node => node.key === other.id);
  await find(row, node => node.props?.children === "移除").props.onClick();
  await find(render(), node => node.props?.title === "确认移除规划版本").props.onConfirm();
  expect(harness.remove).toHaveBeenCalledWith(other.id, { expected_revision: 1, confirm_submitted: false });
  expect(harness.context.refreshPlanningVersions).toHaveBeenCalledTimes(1);
  expect(harness.context.refresh).not.toHaveBeenCalled();
  expect(harness.select).not.toHaveBeenCalled();
});

it("reloads a replacement workspace after deleting the selected version", async () => {
  const row = find(render(), node => node.key === current.id);
  await find(row, node => node.props?.children === "移除").props.onClick();
  await find(render(), node => node.props?.title === "确认移除规划版本").props.onConfirm();
  expect(harness.context.refresh).toHaveBeenCalledWith({ preservePage: true });
  expect(harness.context.refreshPlanningVersions).not.toHaveBeenCalled();
  expect(harness.select).toHaveBeenCalledWith("");
});

it("preserves creating and selecting the new version before its workspace loads", async () => {
  find(render(), node => node.props?.children === "＋ 创建规划版本").props.onClick();
  find(render(), node => node.props?.placeholder === "例如 202701").props.onChange({ target: { value: "202703" } });
  find(render(), node => node.props?.maxLength === "100").props.onChange({ target: { value: "New" } });
  await find(render(), node => node.props?.title === "创建规划版本").props.onConfirm();
  expect(harness.create).toHaveBeenCalledWith({ id: "202703", name: "New", creation_mode: "empty" });
  expect(harness.select).toHaveBeenCalledWith("202703");
  expect(harness.context.refresh).toHaveBeenCalledWith({ preservePage: true });
});

it("reloads the current workspace when publishing another version may deactivate it", async () => {
  harness.context.state.planningVersion = { ...current, open: true };
  const row = find(render(), node => node.key === other.id);
  find(row, node => node.props?.children === "启用").props.onClick();
  await find(render(), node => node.props?.title === "启用版本 · Other").props.onConfirm();
  expect(harness.update).toHaveBeenCalledWith(other.id, { expected_revision: 1, published: true, open: true });
  expect(harness.context.refresh).toHaveBeenCalledWith({ preservePage: true });
  expect(harness.context.refreshPlanningVersions).not.toHaveBeenCalled();
  expect(harness.select).not.toHaveBeenCalled();
});

it("also reloads the current workspace after republishing another inactive version", async () => {
  harness.context.state.planningVersions = [current, { ...other, published: true }];
  const row = find(render(), node => node.key === other.id);
  find(row, node => node.props?.children === "启用").props.onClick();
  await find(render(), node => node.props?.title === "启用版本 · Other").props.onConfirm();
  expect(harness.update).toHaveBeenCalledWith(other.id, { expected_revision: 1, published: true, open: true });
  expect(harness.context.refresh).toHaveBeenCalledWith({ preservePage: true });
  expect(harness.context.refreshPlanningVersions).not.toHaveBeenCalled();
});

it("reports workspace refresh failure after publishing another version", async () => {
  harness.context.refresh.mockResolvedValue(false);
  const row = find(render(), node => node.key === other.id);
  find(row, node => node.props?.children === "启用").props.onClick();
  await find(render(), node => node.props?.title === "启用版本 · Other").props.onConfirm();
  expect(harness.context.notify).toHaveBeenCalledWith(expect.stringContaining("刷新失败"), true);
  expect(harness.context.notify).not.toHaveBeenCalledWith("规划版本已保存。");
});

it.each([true, false])("edits version metadata without changing open/published flags (open=%s)", async (open) => {
  const edited = { ...current, open, deadline: "2026-11-01T00:00:00Z" };
  harness.context.state.planningVersion = edited;
  harness.context.state.planningVersions = [edited, other];
  const row = find(render(), node => node.key === current.id);
  find(row, node => node.props?.children === "编辑").props.onClick();
  find(render(), node => node.props?.maxLength === "100").props.onChange({ target: { value: "Updated" } });
  find(render(), node => node.props?.title === `编辑规划版本 · ${current.id}`).props.onConfirm();
  await find(render(), node => node.props?.title === "确认修改规划版本").props.onConfirm();
  expect(harness.update).toHaveBeenCalledWith(current.id, {
    expected_revision: current.revision, id: current.id, name: "Updated",
  });
  expect(harness.context.refresh).toHaveBeenCalledWith({ preservePage: true });
});

function all(node, predicate) {
  if (Array.isArray(node)) return node.flatMap(child => all(child, predicate));
  if (!node || typeof node !== "object") return [];
  return [...(predicate(node) ? [node] : []), ...all(node.props?.children, predicate)];
}
const rowFor = id => find(render(), node => node.key === id);
const action = (id, label) => find(rowFor(id), node => node.props?.children === label);
const dialogFor = title => find(render(), node => node.props?.title === title) || null;

it.each([
  ["未启用", false, false, [false, false, false, true, false]],
  ["已停用", true, false, [false, false, false, true, false]],
  ["已启用", true, true, [false, true, true, false, false]],
])("keeps ordered version controls with correct disabled states for %s", (_status, published, open, disabled) => {
  harness.context.state.planningVersions = [{ ...current, published, open }];
  const controls = all(rowFor(current.id), node => node.props?.onClick);
  expect(controls.map(node => node.props.children)).toEqual(["编辑", "移除", "启用", "停用", "清空草稿"]);
  expect(controls.map(node => node.props.disabled)).toEqual(disabled);
});

it.each([{ previewMode: true }, { apiMode: false }])("disables all version actions in read-only context %o", settings => {
  Object.assign(harness.context, settings);
  expect(all(rowFor(current.id), node => node.props?.onClick).every(node => node.props.disabled)).toBe(true);
});

it("deactivation only closes the window, preserves publication visibility and refreshes the selected workspace", async () => {
  harness.context.state.planningVersions = [{ ...current, open: true }];
  action(current.id, "停用").props.onClick();
  await dialogFor("停用版本 · Current").props.onConfirm();
  expect(harness.update).toHaveBeenCalledExactlyOnceWith(current.id, { expected_revision: current.revision, open: false });
  expect(harness.remove).not.toHaveBeenCalled();
  expect(harness.select).not.toHaveBeenCalled();
  expect(harness.context.refresh).toHaveBeenCalledWith({ preservePage: true });
});

it("cancelling a lifecycle dialog does not write or refresh", () => {
  action(current.id, "启用").props.onClick();
  dialogFor("启用版本 · Current").props.onClose();
  expect(dialogFor("启用版本 · Current")).toBeNull();
  expect(harness.update).not.toHaveBeenCalled();
  expect(harness.context.refresh).not.toHaveBeenCalled();
});

it("retains the dialog and state on an API conflict without reporting success", async () => {
  harness.update.mockRejectedValueOnce(Error("版本已变化，请刷新后重试"));
  action(current.id, "启用").props.onClick();
  await dialogFor("启用版本 · Current").props.onConfirm();
  expect(dialogFor("启用版本 · Current")).not.toBeNull();
  expect(find(render(), node => node.props?.children === "版本已变化，请刷新后重试")).not.toBeNull();
  expect(harness.context.refresh).not.toHaveBeenCalled();
  expect(harness.context.state.planningVersion.open).toBe(false);
  expect(harness.context.notify).not.toHaveBeenCalledWith("规划版本已保存。");
});

it("submits a lifecycle operation only once while its request is pending", async () => {
  let finish;
  harness.update.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  action(current.id, "启用").props.onClick();
  const confirm = dialogFor("启用版本 · Current").props.onConfirm;
  const pending = confirm();
  await confirm();
  expect(harness.update).toHaveBeenCalledTimes(1);
  expect(all(rowFor(current.id), node => node.props?.onClick).every(node => node.props.disabled)).toBe(true);
  expect(dialogFor("启用版本 · Current").props.busy).toBe(true);
  finish(current);
  await pending;
  expect(dialogFor("启用版本 · Current")).toBeNull();
});

it("blocks a previously opened operation when context changes to read-only", async () => {
  action(current.id, "启用").props.onClick();
  harness.context.previewMode = true;
  const dialog = dialogFor("启用版本 · Current");
  expect(dialog.props.disabled).toBe(true);
  await dialog.props.onConfirm();
  expect(harness.update).not.toHaveBeenCalled();
});

it("requires submitted-version acknowledgement and a second confirmation before removal", async () => {
  harness.info.mockResolvedValue({ canDelete: true, revision: 7, submittedCount: 4 });
  await action(current.id, "移除").props.onClick();
  expect(dialogFor("移除前请确认").props.disabled).toBe(true);
  expect(harness.remove).not.toHaveBeenCalled();
  find(render(), node => node.props?.onCheckedChange).props.onCheckedChange(true);
  expect(dialogFor("移除前请确认").props.disabled).toBe(false);
  dialogFor("移除前请确认").props.onConfirm();
  expect(harness.remove).not.toHaveBeenCalled();
  await dialogFor("确认移除规划版本").props.onConfirm();
  expect(harness.remove).toHaveBeenCalledExactlyOnceWith(current.id, { expected_revision: 7, confirm_submitted: true });
});

it("does not offer removal if the latest server state is active", async () => {
  harness.info.mockResolvedValue({ canDelete: false, revision: 7, submittedCount: 4 });
  await action(current.id, "移除").props.onClick();
  expect(dialogFor("移除前请确认")).toBeNull();
  expect(dialogFor("确认移除规划版本")).toBeNull();
  expect(harness.remove).not.toHaveBeenCalled();
  expect(find(render(), node => node.props?.children === "请先停用版本，再移除规划版本。")).not.toBeNull();
});

it.each([
  ["existing", current.id, { creation_mode: "copy", source_version_id: current.id }],
  ["first", "legacy", {}],
])("supports explicitly copying a source for %s version creation", async (scenario, choice, expected) => {
  if (scenario === "first") harness.context.state.planningVersions = [];
  find(render(), node => node.props?.children === "＋ 创建规划版本").props.onClick();
  find(render(), node => node.props?.value === "empty" && node.props.onChange).props.onChange({ target: { value: choice } });
  find(render(), node => node.props?.placeholder === "例如 202701").props.onChange({ target: { value: "202703" } });
  find(render(), node => node.props?.maxLength === "100").props.onChange({ target: { value: "New" } });
  await dialogFor("创建规划版本").props.onConfirm();
  expect(harness.create).toHaveBeenCalledExactlyOnceWith({ id: "202703", name: "New", ...expected });
});

it("only offers published sources and rejects copying from a later version", async () => {
  find(render(), node => node.props?.children === "＋ 创建规划版本").props.onClick();
  const source = () => find(render(), node => node.props?.value === "empty" && node.props.onChange);
  expect(find(source(), node => node.props?.value === other.id)).toBeFalsy();
  expect(find(source(), node => node.props?.value === current.id)).toBeTruthy();
  source().props.onChange({ target: { value: current.id } });
  find(render(), node => node.props?.placeholder === "例如 202701").props.onChange({ target: { value: "202612" } });
  find(render(), node => node.props?.maxLength === "100").props.onChange({ target: { value: "New" } });
  const dialog = dialogFor("创建规划版本");
  expect(dialog.props.disabled).toBeTruthy();
  await dialog.props.onConfirm();
  expect(harness.create).not.toHaveBeenCalled();
});

it("asks before clearing all drafts for the named version and cancellation writes nothing", () => {
  action(other.id, "清空草稿").props.onClick();
  const dialog = dialogFor("清空全部草稿 · 202702 · Other");
  expect(dialog.props.confirmLabel).toBe("确认清空全部草稿");
  expect(dialog.props.confirmVariant).toBe("destructive");
  expect(harness.clear).not.toHaveBeenCalled();
  dialog.props.onClose();
  expect(dialogFor("清空全部草稿 · 202702 · Other")).toBeNull();
  expect(harness.clear).not.toHaveBeenCalled();
  expect(harness.context.refreshPlanningVersions).not.toHaveBeenCalled();
});

it.each([current, other])("resets only version $id at the revision shown in the confirmation", async version => {
  action(version.id, "清空草稿").props.onClick();
  const confirm = dialogFor(`清空全部草稿 · ${version.id} · ${version.name}`).props.onConfirm;
  await Promise.all([confirm(), confirm()]);
  expect(harness.clear).toHaveBeenCalledExactlyOnceWith(version.id, {
    expected_revision: version.revision, confirmed: true,
  });
  expect(harness.context.refresh).toHaveBeenCalledTimes(version.id === current.id ? 1 : 0);
  expect(harness.context.refreshPlanningVersions).toHaveBeenCalledTimes(version.id === current.id ? 0 : 1);
  expect(harness.select).not.toHaveBeenCalled();
  expect(harness.context.notify).toHaveBeenCalledWith(`版本 ${version.id} 的全部草稿已清空。`);
});

it("keeps the confirmation open if clear-drafts fails and preserves the old revision for retries", async () => {
  harness.clear.mockRejectedValueOnce(Error("版本已变化，请刷新后重试"));
  action(other.id, "清空草稿").props.onClick();
  await dialogFor("清空全部草稿 · 202702 · Other").props.onConfirm();
  expect(dialogFor("清空全部草稿 · 202702 · Other")).not.toBeNull();
  expect(find(render(), node => node.props?.children === "版本已变化，请刷新后重试")).not.toBeNull();
  expect(harness.context.refreshPlanningVersions).not.toHaveBeenCalled();
  expect(harness.context.notify).not.toHaveBeenCalled();
});

it("reports a completed clear separately from a failed version-list reload", async () => {
  harness.context.refreshPlanningVersions.mockRejectedValueOnce(Error("网络中断"));
  action(other.id, "清空草稿").props.onClick();
  await dialogFor("清空全部草稿 · 202702 · Other").props.onConfirm();
  expect(dialogFor("清空全部草稿 · 202702 · Other")).toBeNull();
  expect(harness.clear).toHaveBeenCalledTimes(1);
  expect(harness.context.notify).toHaveBeenCalledWith(expect.stringContaining("全部草稿已清空，但刷新失败"), true);
});
