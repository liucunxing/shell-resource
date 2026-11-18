import { afterEach, beforeEach, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ slots: [], cursor: 0, context: null }));
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
  useEffect: () => {},
  useLayoutEffect: () => {},
}));
vi.mock("../src/workbench/WorkbenchContext.jsx", () => ({ useWorkbench: () => harness.context }));
import { TableBody } from "../src/components/ui/table";
import { EditorPage } from "../src/workbench/pages/EditorPage.jsx";
import E from "../src/workbench/domain/engine.js";
import data from "../src/workbench/domain/demo-data.json";
import { reserveAcknowledgementFingerprint } from "../src/workbench/domain/reserve-review.js";

// Invoke the actual editor component with the project's lightweight hook harness.
// Child components remain element objects, so tests exercise real event handlers.
function render() {
  harness.cursor = 0;
  harness.context.view = E.selectView(harness.context.state, harness.context.identity);
  const editor = EditorPage();
  return editor.type(editor.props);
}
function elements(node) {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !node.props) return [];
  return [node, ...elements(node.props.children)];
}
const steps = tree => elements(tree).find(node => node.props.className === "v19-workspace-tabs");
const button = (tree, label) => elements(tree).find(node => node.props.children === label && node.props.onClick);
const item = () => harness.context.state.initiatives[0];

beforeEach(() => {
  harness.slots = [];
  const state = E.createState(data, "working");
  state.initiatives = [state.initiatives[0]];
  const current = state.initiatives[0];
  current.rows = [];
  current.otherBudgets = [];
  current.workflow = { editable: true, submitted: false };
  current.editorState = { step: 1, reserveAcknowledgement: reserveAcknowledgementFingerprint(current) };
  state.planningVersion = { id: "202701", published: true, open: true };
  const identity = { role: "owner", email: "owner@example.test", ownerId: current.ownerId, department: [current.department] };
  harness.context = {
    state, identity, data, apiMode: true, initiativeId: current.id,
    dirtyIds: new Set(), savedForSyncIds: new Set(), editorOperations: {},
    notify: vi.fn(), navigate: vi.fn(), publish: vi.fn(), loadDistributorDirectory: vi.fn(),
    mutate: vi.fn(change => { change(state); return true; }),
    saveDraft: vi.fn().mockResolvedValue(true),
  };
  vi.stubGlobal("document", { querySelectorAll: () => [] });
});
afterEach(() => vi.unstubAllGlobals());

it.each([1, 2, 3])("shows manual save only in step 3 (current step %s)", step => {
  item().editorState.step = step;
  const tree = render();
  expect(Boolean(button(tree, "保存草稿"))).toBe(step === 3);
  expect(Boolean(button(tree, "下一步 →"))).toBe(step < 3);
  if (step === 3)
    expect(elements(tree).some(node => node.props.children === "提交到 202701 →")).toBe(true);
});

it("next saves the intended step and review before advancing, and stays put while pending", async () => {
  let finish;
  harness.context.saveDraft.mockImplementationOnce((id) => {
    harness.context.editorOperations[id] = "save";
    return new Promise(resolve => { finish = () => { delete harness.context.editorOperations[id]; resolve(true); }; });
  });
  button(render(), "下一步 →").props.onClick();
  expect(harness.context.saveDraft).toHaveBeenCalledWith(item().id, {
    changeReason: "", editorState: { step: 2, reserveAcknowledgement: reserveAcknowledgementFingerprint(item()) },
  });
  let tree = render();
  expect(steps(tree).props.value).toBe("1");
  expect(button(tree, "正在保存…").props.disabled).toBe(true);
  await steps(tree).props.onValueChange("3");
  expect(harness.context.saveDraft).toHaveBeenCalledTimes(1);
  finish();
  await Promise.resolve();
  tree = render();
  expect(steps(tree).props.value).toBe("2");
  expect(harness.context.publish).not.toHaveBeenCalled();
});

it("a failed autosave keeps the current step and draft contents", async () => {
  harness.context.saveDraft.mockResolvedValueOnce(false);
  const before = structuredClone(item());
  await steps(render()).props.onValueChange("2");
  expect(steps(render()).props.value).toBe("1");
  expect(item()).toEqual(before);
  expect(harness.context.publish).not.toHaveBeenCalled();
});

it("jumping forward with a top tab also overwrites the current draft before advancing", async () => {
  await steps(render()).props.onValueChange("3");
  expect(harness.context.saveDraft).toHaveBeenCalledWith(item().id, expect.objectContaining({
    editorState: { step: 3, reserveAcknowledgement: reserveAcknowledgementFingerprint(item()) },
  }));
  expect(steps(render()).props.value).toBe("3");
});

it("going backwards remembers the position without an extra save request", async () => {
  item().editorState.step = 3;
  await steps(render()).props.onValueChange("2");
  expect(steps(render()).props.value).toBe("2");
  expect(item().editorState.step).toBe(2);
  expect(harness.context.saveDraft).not.toHaveBeenCalled();
});

it("read-only step navigation never writes a draft", async () => {
  item().workflow.editable = false;
  await steps(render()).props.onValueChange("3");
  const tree = render();
  expect(steps(tree).props.value).toBe("3");
  expect(button(tree, "保存草稿")).toBeUndefined();
  expect(harness.context.saveDraft).not.toHaveBeenCalled();
  expect(harness.context.mutate).not.toHaveBeenCalled();
});

it("invalid input blocks next-step autosave and keeps focus on the error", async () => {
  const invalid = { dataset: { invalidMessage: "金额无效" }, focus: vi.fn() };
  vi.stubGlobal("document", { querySelectorAll: () => [invalid] });
  await steps(render()).props.onValueChange("2");
  expect(harness.context.saveDraft).not.toHaveBeenCalled();
  expect(steps(render()).props.value).toBe("1");
  expect(invalid.focus).toHaveBeenCalled();
});


it("removes a reserve with an empty amount while still guarding other rows", () => {
  item().otherBudgets = [
    { id: "r1", reasonId: "reserve", amount: 0 },
    { id: "r2", reasonId: "reserve", amount: 250 },
  ];
  const emptyAmount = { dataset: {}, focus: vi.fn() };
  const otherInvalidAmount = { dataset: {}, focus: vi.fn() };
  const removedRow = { contains: (input) => input === emptyAmount };
  const event = { currentTarget: { closest: () => removedRow } };
  const remove = elements(render()).find(node => node.props["aria-label"] === "移除第 1 项预算安排");

  vi.stubGlobal("document", { querySelectorAll: () => [emptyAmount, otherInvalidAmount] });
  remove.props.onClick(event);
  expect(item().otherBudgets.map(row => row.id)).toEqual(["r1", "r2"]);
  expect(otherInvalidAmount.focus).toHaveBeenCalledOnce();
  expect(emptyAmount.focus).not.toHaveBeenCalled();

  vi.stubGlobal("document", { querySelectorAll: () => [emptyAmount] });
  harness.context.notify.mockClear();
  remove.props.onClick(event);
  expect(item().otherBudgets.map(row => [row.id, row.amount])).toEqual([["r2", 250]]);
  expect(harness.context.notify).not.toHaveBeenCalled();
});

it("shows the live project balance next to the dealer total, including reserve", () => {
  item().editorState.step = 3;
  item().budget = 1000;
  item().rows = [{ dealerId: data.dealers[0].id, amount: 600 }];
  item().otherBudgets = [{ id: "r1", reasonId: "reserve", amount: 250 }];
  item().editorState.reserveAcknowledgement = reserveAcknowledgementFingerprint(item());
  const gap = () => elements(render()).find(node => node.props.className === "allocation-balance-gap")?.props.children;
  expect(gap()).toBe("（-150.0 元）");
  item().rows[0].amount = 800;
  expect(gap()).toBe("（+50.0 元）");
  item().rows[0].amount = 750;
  expect(gap()).toBeUndefined();
});

function prepareTrial() {
  item().rows = data.dealers.slice(0, 2).map((dealer, index) => ({ dealerId: dealer.id, amount: index + 10, note: "原分配", dealerCode: `code-${index}`, sd: "SD", rsm: "RSM" }));
  item().editorState.step = 3;
  return structuredClone(item().rows);
}

it("keeps each allocation remove button available and confirms before removing", () => {
  const before = prepareTrial();
  const remove = elements(render()).find(node => node.props.className === "v19-allocation-remove");
  expect(remove.props["aria-label"]).toContain("移除经销商");
  remove.props.onClick();
  expect(item().rows).toEqual(before);
  const modal = elements(render()).find(node => node.props.action?.props.children === "确认移除");
  expect(modal).toBeTruthy();
  modal.props.action.props.onClick();
  expect(item().rows).toHaveLength(before.length - 1);
});

it("shares one period between the allocation table and the quick schemes", () => {
  const baseline = prepareTrial();
  const panel = () => elements(render()).find(node => node.props.className === "panel v19-allocation-panel");
  const controls = () => elements(panel()).filter(node => node.props.onPeriodChange);
  const volumes = () => {
    const body = elements(panel()).find(node => node.type === TableBody);
    return elements(body).filter(node => node.props["data-column"] === "vol").map(node => node.props.children);
  };
  expect(controls()).toHaveLength(1);
  expect(elements(controls()[0]).some(node => node.props.onCheckedChange)).toBe(true);
  const quickRow = elements(panel()).find(node => node.props.className === "v19-trial-tools");
  const search = quickRow.props.children.at(-1);
  expect(search.props.type).toBe("search");

  const annual = volumes();
  expect(annual.length).toBeGreaterThan(0);
  controls()[0].props.onPeriodChange("2026Ytd");
  expect(volumes()).not.toEqual(annual);
  expect(item().rows).toEqual(baseline);

  search.props.onChange({ target: { value: "no matching dealer" } });
  expect(volumes()).toHaveLength(0);
  button(render(), "按Actual Delivery Vol采用").props.onClick();
  expect(item().editorState.trial.period).toBe("2026Ytd");
  expect(item().rows.every(row => row.amount > 0)).toBe(true);
});

it("restores each initiative's selected scheme after remount and cancels to its original allocations", () => {
  const baseline = prepareTrial();
  button(render(), "按历史投资总额采用").props.onClick();
  expect(button(render(), "按历史投资总额采用").props["aria-pressed"]).toBe(true);
  const allocated = structuredClone(item().rows);
  const second = structuredClone(item());
  second.id = "another-initiative";
  second.editorState = { step: 3, reserveAcknowledgement: reserveAcknowledgementFingerprint(second) };
  harness.context.state.initiatives.push(second);
  harness.context.initiativeId = second.id;
  harness.slots = [];
  button(render(), "按Actual C3采用").props.onClick();
  expect(button(render(), "按Actual C3采用").props["aria-pressed"]).toBe(true);
  harness.context.initiativeId = item().id;
  harness.slots = [];
  expect(item().rows).toEqual(allocated);
  expect(button(render(), "按历史投资总额采用").props["aria-pressed"]).toBe(true);
  button(render(), "按Actual Delivery Vol采用").props.onClick();
  harness.slots = [];
  button(render(), "按Actual Delivery Vol采用").props.onClick();
  expect(item().rows).toEqual(baseline);
  expect(button(render(), "按Actual Delivery Vol采用").props["aria-pressed"]).toBe(false);
  harness.context.initiativeId = second.id;
  harness.slots = [];
  expect(button(render(), "按Actual C3采用").props["aria-pressed"]).toBe(true);
});

it("retains trial metadata when autosaving forward after visiting earlier steps", async () => {
  prepareTrial();
  button(render(), "按Actual C3采用").props.onClick();
  const trial = structuredClone(item().editorState.trial);
  await steps(render()).props.onValueChange("2");
  await steps(render()).props.onValueChange("3");
  expect(harness.context.saveDraft).toHaveBeenCalledWith(item().id, expect.objectContaining({
    editorState: expect.objectContaining({ step: 3, trial }),
  }));
});

it("restores the applied history period and clears the choice only after confirming clear amounts", () => {
  prepareTrial();
  const controls = () => elements(render()).find(node => node.props.onPeriodChange && node.props.onMetricChange);
  controls().props.onPeriodChange("2026Ytd");
  button(render(), "按Actual C3采用").props.onClick();
  harness.slots = [];
  expect(controls().props.period).toBe("2026Ytd");
  expect(button(render(), "按Actual C3采用").props["aria-pressed"]).toBe(true);
  elements(render()).find(node => node.props["aria-label"] === "清空经销商分配").props.onClick();
  const modal = elements(render()).find(node => node.props.action?.props.children === "确认清空");
  expect(item().editorState.trial).not.toBeNull();
  modal.props.action.props.onClick();
  expect(item().editorState.trial).toBeNull();
  expect(item().rows.every(row => row.amount === 0)).toBe(true);
});
