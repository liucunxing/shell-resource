import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import E from "../src/workbench/domain/engine.js";
import X from "../src/workbench/domain/explore.js";
import D from "../src/workbench/domain/demo-data.json";
import { InsightPanel, BusinessPromptEditor } from "../src/workbench/pages/InsightPanel.jsx";
import { ManagementPage } from "../src/workbench/pages/OverviewPages.jsx";
import { EditorPage } from "../src/workbench/pages/EditorPage.jsx";
import { HistoricalResourceSettings } from "../src/workbench/pages/HistoricalResourceSettings.jsx";

const shared = vi.hoisted(() => ({ context: null }));
vi.mock("../src/workbench/WorkbenchContext.jsx", () => ({ useWorkbench: () => shared.context }));

beforeEach(() => {
  const state = E.createState(D, "working");
  const identity = { role: "admin", key: "admin", email: "admin@example.test", department: [] };
  shared.context = { state, identity, data: D, view: E.selectView(state, identity), apiMode: true,
    initiativeId: state.initiatives[0].id, dirtyIds: new Set(), savedForSyncIds: new Set(),
    editorOperations: {}, directoryStatus: {}, notify: vi.fn(), loadDistributorDirectory: vi.fn() };
});

it.each(["management", "admin"])("%s has a real API generation button and clear synced-only label", (role) => {
  shared.context.identity.role = role;
  const html = renderToStaticMarkup(<InsightPanel />);
  expect(html).toContain("生成分析");
  expect(html).toContain("最新同步版本，不包含未同步草稿");
  expect(html).not.toContain("分析方案由能力包维护");
});

it("admin overview offers explicit draft/synced versions and readonly details", () => {
  const html = renderToStaticMarkup(<ManagementPage />);
  expect(html).toContain("当前工作稿（含未同步调整）");
  expect(html).toContain("各项目最新同步版本");
  expect(html).toContain("查看明细");
  expect(html).not.toContain("查看 / 调整");
  const editor = renderToStaticMarkup(<EditorPage />);
  expect(editor).not.toContain(">保存草稿<");
  expect(editor).not.toContain(">同步最新分配<");
  expect(editor).not.toContain("可继续修改");
});

it("the resource settings support shared resource types and explain the historical aggregate", () => {
  const html = renderToStaticMarkup(<HistoricalResourceSettings
    mapping={{ MKT: ["MRD", "SP&A"], ICE: ["SP&A"] }} departments={["NEW"]} saveConfig={vi.fn()} />);
  expect(html).toContain('aria-label="ICE 可查看 SP&amp;A" checked=""');
  expect(html).toContain('aria-label="NEW 可查看 MRD"');
  expect(html).toContain("暂不拆部门");
});

it("business prompts expose prior versions and clearly defer their effect to regeneration", () => {
  const html = renderToStaticMarkup(<BusinessPromptEditor prompt={{ version: 2, text: "新关注点",
    versions: [{ version: 1, text: "原关注点" }, { version: 2, text: "新关注点" }] }} onSaved={vi.fn()} />);
  expect(html).toContain("保存，下次生成生效");
  expect(html).toContain("原关注点");
  expect(html).toContain("已有摘要保留原版本");
});

it.each(["owner", "lead"])("%s historical display and export obey configurable unions, with no total column", (role) => {
  const state = shared.context.state;
  state.departmentResources = { MKT: ["MRD"], ICE: ["SP&A"], CUSTOM: ["Capex"] };
  const identity = { role, department: ["MKT", "ICE"], ownerId: state.initiatives[0].ownerId };
  const model = X.rawData(state, identity, D, "history");
  expect(model.rows).toHaveLength(D.dealers.length);
  expect(model.columns.filter((column) => column.key.startsWith("resource_")).map((column) => column.key))
    .toEqual(["resource_MRD", "resource_SP&A"]);
  expect(X.csv(model)).not.toContain("总资源");
  expect(X.csv(model)).not.toContain("2025 Capex");
  expect(X.csv(model)).not.toContain("2025 ICE Rebate");
  state.departmentResources = {};
  expect(X.rawData(state, identity, D, "history").columns.some((column) => column.key.startsWith("resource_"))).toBe(false);
});
