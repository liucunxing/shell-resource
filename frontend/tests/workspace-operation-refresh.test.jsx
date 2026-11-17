import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const harness = vi.hoisted(() => ({ slots: [], cursor: 0, context: null,
  workspace: vi.fn(), versions: vi.fn(), save: vi.fn(), publish: vi.fn(), getDraft: vi.fn() }));
vi.mock("react", async (original) => ({
  ...(await original()),
  useState(initial) {
    const index = harness.cursor++;
    if (!(index in harness.slots)) harness.slots[index] = typeof initial === "function" ? initial() : initial;
    return [harness.slots[index], (value) => {
      harness.slots[index] = typeof value === "function" ? value(harness.slots[index]) : value;
    }];
  },
  useRef(initial) { const index = harness.cursor++; return harness.slots[index] ??= { current: initial }; },
  useEffect: () => {},
}));
vi.mock("../src/workbench/api.js", () => ({
  acceptPortalEmail: vi.fn(), getDevelopmentEmail: () => "owner@example.test", setPlanningVersion: vi.fn(),
  workspace: harness.workspace, planningVersions: harness.versions,
  saveDraft: harness.save, publish: harness.publish, getDraft: harness.getDraft,
}));
import { WorkbenchProvider, useWorkbench } from "../src/workbench/WorkbenchContext.jsx";
import E from "../src/workbench/domain/engine.js";
import { hasReserveAcknowledgement, reserveAcknowledgementFingerprint, restoredEditorStep } from "../src/workbench/domain/reserve-review.js";

const version = { id: "202701", revision: 4, published: true, open: true };
const initiative = { id: "1", department: "MKT", sector: "B2B", revision: 7,
  rows: [{ dealerId: "D1", amount: 20 }], otherBudgets: [] };
const payload = (current = version) => ({
  identity: { role: "owner", department: ["MKT"], email: "owner@example.test" },
  state: { currentVersionId: current.id, planningVersion: current, planningVersions: [current], initiatives: [initiative] },
});
function Probe() { harness.context = useWorkbench(); return null; }
function render() {
  harness.cursor = 0;
  renderToStaticMarkup(<WorkbenchProvider><Probe /></WorkbenchProvider>);
  return harness.context;
}
beforeEach(async () => {
  harness.slots = [];
  harness.workspace.mockReset().mockResolvedValue(payload());
  harness.versions.mockReset().mockResolvedValue([version, { id: "202702", revision: 1 }]);
  harness.save.mockReset().mockResolvedValue({ ...initiative, revision: 8 });
  harness.getDraft.mockReset().mockResolvedValue({ ...initiative, revision: 12 });
  harness.publish.mockReset().mockImplementation(async (_id, draft) => ({ id: "P-1", publishedRevision: draft.revision }));
  vi.stubGlobal("document", { querySelector: () => null });
  render(); await harness.context.refresh(); render();
  harness.workspace.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

it("submits a clean loaded draft in one request with its server revision", async () => {
  await expect(harness.context.publish("1", "本版说明")).resolves.toMatchObject({ publishedRevision: 7 });
  expect(harness.save).not.toHaveBeenCalled();
  expect(harness.publish).toHaveBeenCalledWith("1", expect.objectContaining({ revision: 7 }), "本版说明");
  expect(harness.workspace).not.toHaveBeenCalled();
});

it("accepts an updated submission reason even when allocation rows did not need saving", async () => {
  harness.publish.mockResolvedValueOnce({ id: "P-1", publishedRevision: 7, initiative: { changeReason: "新的调整依据" } });
  await harness.context.publish("1", "新的调整依据");
  expect(harness.save).not.toHaveBeenCalled();
  expect(render().state.initiatives[0].changeReason).toBe("新的调整依据");
});

it("saves pending allocation edits before submitting the returned server revision", async () => {
  harness.context.mutate((state) => { state.initiatives[0].revision++; state.initiatives[0].rows[0].amount = 25; });
  render();
  await harness.context.publish("1", "修改金额");
  expect(harness.save).toHaveBeenCalledWith("1", expect.objectContaining({ changeReason: "修改金额", rows: [{ dealerId: "D1", amount: 25 }] }), 7);
  expect(harness.publish).toHaveBeenCalledWith("1", expect.objectContaining({ revision: 8 }), "修改金额");
});

it("does not save a draft again after a successful explicit save", async () => {
  await harness.context.saveDraft("1"); render();
  await harness.context.publish("1");
  expect(harness.save).toHaveBeenCalledTimes(1);
  expect(harness.publish).toHaveBeenCalledWith("1", expect.objectContaining({ revision: 8 }), "");
});

it("keeps a clean draft and the conflict visible if its server revision changed", async () => {
  harness.publish.mockRejectedValueOnce(Object.assign(new Error("conflict"), { status: 409 }));
  await expect(harness.context.publish("1")).resolves.toBe(false);
  expect(harness.save).not.toHaveBeenCalled();
  expect(render().state.initiatives[0].revision).toBe(7);
  expect(harness.context.toast.message).toContain("已被其他人更新");
});

it("refreshes only version metadata when the loaded version has not changed", async () => {
  const before = harness.context.state.initiatives;
  await expect(harness.context.refreshPlanningVersions()).resolves.toBe(true);
  const context = render();
  expect(context.state.planningVersions).toHaveLength(2);
  expect(context.state.initiatives).toBe(before);
  expect(context.state.currentVersionId).toBe(version.id);
  expect(harness.workspace).not.toHaveBeenCalled();
});

it.each([
  { versions: [{ ...version, revision: 5 }] },
  { versions: [{ id: "202702", revision: 1 }] },
])("reloads current workflow when metadata reveals a changed or missing version", async ({ versions }) => {
  harness.versions.mockResolvedValueOnce(versions);
  await harness.context.refreshPlanningVersions();
  expect(harness.workspace).toHaveBeenCalledTimes(1);
});

it.each([
  { name: "deadline extended on an open version", open: true, confirmed: false, editable: true },
  { name: "deadline extended on an explicitly stopped version", open: false, confirmed: false, editable: false },
  { name: "deadline extended after department confirmation", open: true, confirmed: true, editable: false },
])("reloads deadline and server permissions together: $name", async ({ open, confirmed, editable }) => {
  const expired = { ...version, deadline: "2026-11-16T00:00:00Z", expired: true, open };
  const item = { ...initiative, ownerId: "owner@example.test", workflow: { editable: false, ownerEditLocked: confirmed } };
  harness.workspace.mockResolvedValueOnce({ ...payload(expired), state: { ...payload(expired).state, initiatives: [item] } });
  await harness.context.refresh();
  expect(E.canEdit(render().state, "1", harness.context.identity)).toBe(false);

  const extended = { ...expired, revision: expired.revision + 1, deadline: "2027-01-01T00:00:00Z", expired: false };
  harness.versions.mockResolvedValueOnce([extended]);
  harness.workspace.mockResolvedValueOnce({ ...payload(extended), state: {
    ...payload(extended).state, initiatives: [{ ...item, workflow: { ...item.workflow, editable } }],
  } });
  await harness.context.refreshPlanningVersions();
  const current = render();
  expect(current.state.planningVersion.deadline).toBe(extended.deadline);
  expect(current.state.initiatives[0].workflow.editable).toBe(editable);
  expect(E.canEdit(current.state, "1", current.identity)).toBe(editable);
});

it("discards metadata returned after another workspace refresh", async () => {
  let finish;
  harness.versions.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = harness.context.refreshPlanningVersions();
  await harness.context.refresh();
  finish([{ id: "old", revision: 1 }]);
  await expect(pending).resolves.toBe(false);
  expect(render().state.planningVersions).toEqual([version]);
});


it("opens the newest draft from the primary menu on first entry and after changing versions", async () => {
  const items = [
    { ...initiative, id: "older", ownerId: "owner@example.test", savedAt: "2026-11-16T00:00:00Z", workflow: { editable: true, submitted: false } },
    { ...initiative, id: "newer", ownerId: "owner@example.test", savedAt: "2026-11-17T00:00:00Z", workflow: { editable: true, submitted: false } },
  ];
  harness.workspace.mockResolvedValue({ ...payload(), state: { ...payload().state, initiatives: items } });
  await harness.context.refresh(); render();
  expect(harness.context.navigate("editor")).toBe(true);
  expect(render()).toMatchObject({ page: "editor", initiativeId: "newer" });
  harness.context.navigate("editor", "older"); render();
  expect(harness.context.initiativeId).toBe("older");
  harness.context.navigate("home"); render();
  harness.context.navigate("editor");
  expect(render().initiativeId).toBe("newer");
  harness.workspace.mockResolvedValue({ ...payload(), state: { ...payload().state, currentVersionId: "202702", planningVersion: { ...version, id: "202702" }, initiatives: [{ ...items[0], id: "new-version" }] } });
  await harness.context.refresh(); render();
  harness.context.navigate("editor");
  expect(render().initiativeId).toBe("new-version");
});

it("keeps unsaved allocation state when navigating between initiatives", async () => {
  harness.workspace.mockResolvedValue({ ...payload(), state: { ...payload().state, initiatives: [initiative, { ...initiative, id: "2" }] } });
  await harness.context.refresh(); render();
  harness.context.navigate("editor", "1"); render();
  harness.context.mutate(state => { state.initiatives[0].rows[0].amount = 31; }); render();
  harness.context.navigate("editor", "2"); render();
  harness.context.navigate("editor", "1"); render();
  expect(harness.context.state.initiatives[0].rows[0].amount).toBe(31);
  expect(harness.context.dirtyIds.has("1")).toBe(true);
  expect(harness.save).not.toHaveBeenCalled();
});

it("imports replacement rows using the current server revision instead of the local revision", async () => {
  const rows = [{ dealerId: "D1", amount: 30 }];
  harness.context.mutate((state) => { state.initiatives[0].revision = 10; });
  render();
  harness.save.mockResolvedValueOnce({ ...initiative, rows, revision: 13 });
  await expect(harness.context.saveDraft("1", { rows, otherBudgets: [] }, undefined, true)).resolves.toBe(true);
  expect(harness.getDraft).toHaveBeenCalledWith("1");
  expect(harness.save).toHaveBeenCalledWith("1", expect.objectContaining({ rows }), 12);
  expect(render().state.initiatives[0]).toMatchObject({ revision: 13, rows });
});

it("keeps each initiative's step, checkbox and allocation while switching and after saving/reloading", async () => {
  const first = { ...initiative, ownerId: "owner@example.test", planningVersionId: version.id,
    budget: 100, otherBudgets: [{ id: "temporary", reasonId: "reserve", amount: 10, note: "待定" }] };
  const second = { ...first, id: "2", rows: [{ dealerId: "D1", amount: 0 }], otherBudgets: [] };
  const workspace = { ...payload(), state: { ...payload().state, initiatives: [first, second] } };
  harness.workspace.mockResolvedValue(workspace);
  harness.save.mockImplementation(async (_id, draft) => ({ ...draft, revision: draft.revision + 1,
    otherBudgets: draft.otherBudgets.map((row, index) => ({ ...row, id: String(100 + index) })) }));
  await harness.context.refresh(); render();
  harness.context.navigate("editor", "1"); render();
  harness.context.mutate((state) => {
    const item = state.initiatives[0];
    item.rows = [{ dealerId: "D1", amount: 90 }];
    item.editorState = { step: 3, reserveAcknowledgement: reserveAcknowledgementFingerprint(item) };
  });
  render();
  await expect(harness.context.saveDraft("1")).resolves.toBe(true); render();
  harness.context.navigate("editor", "2"); render();
  harness.context.mutate((state) => {
    const item = state.initiatives[1];
    item.otherBudgets = [{ id: "second-reserve", reasonId: "reserve", amount: 25, note: "预留" }];
    item.editorState = { step: 1, reserveAcknowledgement: reserveAcknowledgementFingerprint(item) };
  });
  render();
  for (const [id, step] of [["1", 3], ["2", 1]]) {
    harness.context.navigate("editor", id); render();
    const item = harness.context.state.initiatives.find(row => row.id === id);
    expect(restoredEditorStep(harness.context.identity, version.id, item, true)).toBe(step);
    expect(hasReserveAcknowledgement(harness.context.identity, version.id, item)).toBe(true);
  }
  expect(harness.context.state.initiatives[0].rows).toEqual([{ dealerId: "D1", amount: 90 }]);
  await harness.context.saveDraft("2"); render();
  const persisted = structuredClone(harness.context.state.initiatives);
  harness.workspace.mockResolvedValue({ ...workspace, state: { ...workspace.state, initiatives: persisted } });
  harness.slots = [];
  vi.stubGlobal("sessionStorage", undefined);
  render(); await harness.context.refresh(); render();
  for (const [id, step] of [["1", 3], ["2", 1]]) {
    const item = harness.context.state.initiatives.find(row => row.id === id);
    expect(restoredEditorStep(harness.context.identity, version.id, item, true)).toBe(step);
    expect(hasReserveAcknowledgement(harness.context.identity, version.id, item)).toBe(true);
  }
  expect(harness.save.mock.calls[0][1].editorState.step).toBe(3);
});

it("preserves a newer step and unchecked review when an earlier save finishes", async () => {
  const initialEditorState = { step: 3, reserveAcknowledgement: "reviewed-before-save" };
  harness.context.mutate(state => { state.initiatives[0].editorState = initialEditorState; });
  render();
  let finishSave;
  harness.save.mockImplementationOnce((_id, draft) => new Promise(resolve => {
    finishSave = () => resolve({ ...draft, revision: 8 });
  }));
  const pending = harness.context.saveDraft("1");
  harness.context.mutate(state => {
    state.initiatives[0].editorState = { step: 1, reserveAcknowledgement: "" };
  });
  render();
  finishSave();
  await pending;
  const context = render();
  expect(context.state.initiatives[0].editorState).toEqual({ step: 1, reserveAcknowledgement: "" });
  expect(context.dirtyIds.has("1")).toBe(true);
  expect(context.savedForSyncIds.has("1")).toBe(false);
});
