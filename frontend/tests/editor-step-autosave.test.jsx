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
  vi.stubGlobal("document", { querySelector: () => null });
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
  vi.stubGlobal("document", { querySelector: () => invalid });
  await steps(render()).props.onValueChange("2");
  expect(harness.context.saveDraft).not.toHaveBeenCalled();
  expect(steps(render()).props.value).toBe("1");
  expect(invalid.focus).toHaveBeenCalled();
});


it("shows the live project balance next to the dealer total, including reserve", () => {
  item().editorState.step = 3;
  item().budget = 1000;
  item().rows = [{ dealerId: data.dealers[0].id, amount: 600 }];
  item().otherBudgets = [{ id: "r1", reasonId: "reserve", amount: 250 }];
  item().editorState.reserveAcknowledgement = reserveAcknowledgementFingerprint(item());
  const gap = () => elements(render()).find(node => node.props.className === "allocation-balance-gap")?.props.children;
  expect(gap()).toBe("（少分 150 元）");
  item().rows[0].amount = 800;
  expect(gap()).toBe("（多分 50 元）");
  item().rows[0].amount = 750;
  expect(gap()).toBeUndefined();
});
