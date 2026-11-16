import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const harness = vi.hoisted(() => ({ slots: [], cursor: 0, context: null,
  workspace: vi.fn(), versions: vi.fn(), save: vi.fn(), publish: vi.fn() }));
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
  saveDraft: harness.save, publish: harness.publish,
}));
import { WorkbenchProvider, useWorkbench } from "../src/workbench/WorkbenchContext.jsx";

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

it("discards metadata returned after another workspace refresh", async () => {
  let finish;
  harness.versions.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = harness.context.refreshPlanningVersions();
  await harness.context.refresh();
  finish([{ id: "old", revision: 1 }]);
  await expect(pending).resolves.toBe(false);
  expect(render().state.planningVersions).toEqual([version]);
});
