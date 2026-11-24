import { afterEach, beforeEach, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ slots: [], cursor: 0, context: null, previewExcel: vi.fn() }));
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
vi.mock("../src/workbench/file-import.js", () => ({ previewExcelInWorker: harness.previewExcel, exportExcelInWorker: vi.fn() }));
import { TableBody, TableCell, TableHead } from "../src/components/ui/table";
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

it.each([["PCMO", true], ["CRTO", false], ["B2B", false], ["OEM", false]])("shows RSM controls only for PCMO (%s)", (sector, expected) => {
  item().sector = sector;
  item().editorState.step = 2;
  const nodes = elements(render());
  expect(nodes.some(node => node.props.children === "全部 RSM")).toBe(expected);
  expect(nodes.some(node => node.type === TableHead && node.props.children === (expected ? "SD / RSM" : "SD"))).toBe(true);
  expect(nodes.some(node => node.type === TableHead && node.props.children === "RSM")).toBe(expected);
});

it("shows source Vol Phasing for both periods without explanatory tooltips", () => {
  item().editorState.step = 2;
  harness.context.data = { ...data, dealers: data.dealers.map(dealer => ({ ...dealer, history: { ...dealer.history, phasing2025: 1.17, phasing2026Ytd: 0 } })) };
  const tree = render();
  const table = elements(tree).find(node => node.props.className === "v19-scope-review");
  const nodes = elements(table);
  const heads = nodes.filter(node => node.type === TableHead);
  expect(heads.find(node => node.props.children === "2025 全年 Actual").props.colSpan).toBe(4);
  expect(heads.find(node => node.props.children === "2026 YTD Actual").props.colSpan).toBe(4);
  for (const label of ["Vol（KL）", "C3（K$）", "Vol Phasing（%）", "Yield"])
    expect(heads.filter(node => node.props.children === label)).toHaveLength(2);
  const body = nodes.find(node => node.type === TableBody);
  const firstRow = Array.isArray(body.props.children) ? body.props.children[0] : body.props.children;
  expect(firstRow).toBeDefined();
  expect(elements(firstRow).filter(node => node.type === TableCell)).toHaveLength(20);
  const phasingCells = elements(firstRow).filter(node => node.type === TableCell && (node.props.sortValue === 1.17 || node.props.sortValue === 0));
  expect(phasingCells.some(node => node.props.sortValue === 1.17 && node.props.children === "117")).toBe(true);
  expect(phasingCells.some(node => node.props.sortValue === 0 && node.props.children === "0")).toBe(true);
  expect(elements(firstRow).some(node => typeof node.props.title === "string" && /phasing/i.test(node.props.title))).toBe(false);
});

it("previews a full plan and writes only on confirmation", async () => {
  item().editorState.step = 3;
  const rows = [{ dealerId: data.dealers[0].id, amount: 25, note: "" }];
  const preview = {
    initiativeId: item().id, revision: item().revision, dealerOnly: true, errors: [],
    rows, otherBudgets: [], summary: { dealerBefore: 0, dealerAfter: 25, otherBudget: 0, gap: 0 },
    rosterEntries: [{ dealerId: rows[0].dealerId, before: null, after: rows[0] }],
  };
  harness.previewExcel.mockResolvedValue(preview);
  const dialog = () => elements(render()).find(node => node.props.title === "Excel 导入预览");
  async function upload() {
    const input = elements(render()).find(node => node.props["aria-label"] === "上传分配 Excel");
    input.props.onChange({ target: { files: [{ name: "plan.xlsx", arrayBuffer: async () => new ArrayBuffer(0) }] } });
    await vi.waitFor(() => expect(dialog()).toBeDefined());
  }
  await upload();
  dialog().props.close();
  expect(dialog()).toBeUndefined();
  expect(harness.context.saveDraft).not.toHaveBeenCalled();
  await upload();
  await dialog().props.action.props.onClick();
  expect(harness.context.saveDraft).toHaveBeenCalledExactlyOnceWith(
    item().id, expect.objectContaining({ rows, otherBudgets: [] }), undefined, true,
  );
  expect(dialog()).toBeUndefined();
});

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


it("removes an empty reserve without committing or discarding another incomplete row", async () => {
  item().otherBudgets = [
    { id: "r1", reasonId: "reserve", amount: 0 },
    { id: "r2", reasonId: "reserve", amount: 250 },
  ];
  const emptyAmount = { dataset: {}, focus: vi.fn() };
  const otherInvalidAmount = { dataset: {}, focus: vi.fn() };
  const remove = elements(render()).find(node => node.props["aria-label"] === "移除第 1 项预算安排");
  vi.stubGlobal("document", { querySelectorAll: () => [emptyAmount, otherInvalidAmount] });
  remove.props.onClick();
  expect(item().otherBudgets.map(row => [row.id, row.amount])).toEqual([["r2", 250]]);
  expect(harness.context.saveDraft).not.toHaveBeenCalled();
  expect(harness.context.notify).not.toHaveBeenCalled();
  vi.stubGlobal("document", { querySelectorAll: () => [otherInvalidAmount] });
  await steps(render()).props.onValueChange("2");
  expect(otherInvalidAmount.focus).toHaveBeenCalledOnce();
  expect(harness.context.saveDraft).not.toHaveBeenCalled();
});

it.each([1, 2, 3])("shows the four budget cards in whole yuan on step %s", step => {
  item().budget = 11_303_278;
  item().rows = [{ dealerId: data.dealers[0].id, amount: 6_303_278 }];
  item().otherBudgets = [{ id: "r1", reasonId: "reserve", amount: 5_000_000 }];
  item().editorState = { step, reserveAcknowledgement: reserveAcknowledgementFingerprint(item()) };
  const cards = elements(render()).find(node => node.props["aria-label"] === "项目预算概况");
  const amounts = elements(cards).filter(node => node.type === "strong").map(node => {
    const [amount, unit] = node.props.children;
    return amount + unit.props.children;
  });
  expect(amounts).toEqual(["11,303,278 元", "5,000,000 元", "6,303,278 元", "0 元"]);
});

it("shows the live project balance next to the dealer total, including reserve", () => {
  item().editorState.step = 3;
  item().budget = 1000;
  item().rows = [{ dealerId: data.dealers[0].id, amount: 600 }];
  item().otherBudgets = [{ id: "r1", reasonId: "reserve", amount: 250 }];
  item().editorState.reserveAcknowledgement = reserveAcknowledgementFingerprint(item());
  const gap = () => elements(render()).find(node => node.props.className === "allocation-balance-gap")?.props.children;
  expect(gap()).toBe("剩余预算 150 元");
  item().rows[0].amount = 800;
  expect(gap()).toBe("超出预算 50 元");
  item().rows[0].amount = 750;
  expect(gap()).toBe("预算已配平");
});

it("keeps exactly the 300 selected identities across all allocation pages, save and return", async () => {
  const dealers = Array.from({ length: 301 }, (_, n) => ({
    ...data.dealers[0], id: `dealer-${n}`, sector: item().sector, status: "active",
  }));
  harness.context.data = { ...data, dealers };
  const selected = dealers.slice(1).reverse().map(d => d.id);
  item().rows = selected.map((dealerId, n) => ({ dealerId, amount: n === 1 ? 50 : 0 }));
  item().editorState.step = 2;
  const bodyKeys = panel => elements(panel).find(n => n.type === TableBody).props.children.flat().filter(Boolean).map(n => n.key);
  const scope = () => elements(render()).find(n => n.props["aria-labelledby"] === "selected-roster-title");
  const allocation = () => elements(render()).find(n => n.props.className === "panel v19-allocation-panel");
  expect(bodyKeys(scope())).toEqual(selected);
  await steps(render()).props.onValueChange("3");
  const displayed = [];
  for (let page = 0; page < 15; page++) {
    displayed.push(...bodyKeys(allocation()));
    if (page < 14) button(allocation(), "下一页").props.onClick();
  }
  expect(displayed).toEqual(selected);
  await button(render(), "保存草稿").props.onClick();
  expect(item().rows.map(r => r.dealerId)).toEqual(selected);
  const remove = elements(allocation()).find(n => n.props.className === "v19-allocation-remove");
  remove.props.onClick();
  const modal = elements(render()).find(n => n.props.action?.props.children === "确认移除");
  modal.props.action.props.onClick();
  const remaining = selected.filter(id => id !== displayed[280]);
  await steps(render()).props.onValueChange("2");
  expect(bodyKeys(scope())).toEqual(remaining);
  await steps(render()).props.onValueChange("3");
  expect(item().rows.map(r => r.dealerId)).toEqual(remaining);
  expect(item().rows[1].amount).toBe(50);
});

function prepareTrial() {
  item().rows = data.dealers.slice(0, 2).map((dealer, index) => ({ dealerId: dealer.id, amount: index + 10, note: "原分配", dealerCode: `code-${index}`, sd: "SD", rsm: "RSM" }));
  item().editorState.step = 3;
  return structuredClone(item().rows);
}

it("clears a dealer amount to zero and accepts the first remove click after blur", () => {
  prepareTrial();
  const amountInput = () => {
    const field = elements(render()).find(node => node.props.label?.endsWith(" 分配金额"));
    return field.type(field.props);
  };
  amountInput().props.onValueChange("");
  const editing = amountInput();
  expect(editing.props.value).toBe("");
  expect(editing.props["aria-invalid"]).toBe(false);
  editing.props.onBlur();
  expect(amountInput().props.value).toBe(0);
  const rowCount = item().rows.length;
  elements(render()).find(node => node.props.className === "v19-allocation-remove").props.onClick();
  const modal = elements(render()).find(node => node.props.action?.props.children === "确认移除");
  modal.props.action.props.onClick();
  expect(item().rows).toHaveLength(rowCount - 1);
  expect(harness.context.notify).not.toHaveBeenCalled();
});

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
