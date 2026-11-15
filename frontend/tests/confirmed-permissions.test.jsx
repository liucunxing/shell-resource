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

it.each(["management", "admin"])("%s has the appropriate generation perspective", (role) => {
  shared.context.identity.role = role;
  const html = renderToStaticMarkup(<InsightPanel />);
  if (role === "admin") {
    expect(html).toContain("模拟用户视角");
    expect(html).toContain("试用分析");
  } else {
    expect(html).toContain("生成分析");
    expect(html).toContain("最新同步版本，不包含未同步草稿");
  }
  expect(html).not.toContain("分析方案由能力包维护");
});

it("management overview follows the customer V19 readonly board", () => {
  const html = renderToStaticMarkup(<ManagementPage />);
  expect(html).toContain("全局投资看板");
  expect(html).toContain("只读，基于部门已确认方案");
  expect(html).toContain("总盘 · 资源大类");
  expect(html).toContain("集中度");
  expect(html).toContain("经销商明细");
  expect(html).not.toContain("当前工作稿（含未同步调整）");
  expect(html).not.toContain("查看 / 调整");
  const editor = renderToStaticMarkup(<EditorPage />);
  expect(editor).not.toContain(">保存草稿<");
  expect(editor).not.toContain(">提交当前方案<");
  expect(editor).not.toContain("可继续修改");
});

it("the resource settings support shared resource types and explain the historical aggregate", () => {
  const html = renderToStaticMarkup(<HistoricalResourceSettings
    mapping={{ MKT: ["MRD", "SP&A"], ICE: ["SP&A"] }} departments={["NEW"]} saveConfig={vi.fn()} />);
  expect(html).toContain('aria-label="历史费用默认权限所属部门"');
  expect(html).toMatch(/<option[^>]*value="ICE"[^>]*>ICE<\/option>/);
  expect(html).toMatch(/<option[^>]*value="PCMO\|MKT"[^>]*>PCMO \/ MKT<\/option>/);
  expect(html).toContain("按用户收窄权限");
  expect(html).not.toContain("角色默认权限");
  expect(html).toContain("保存部门默认");
  expect(html).toContain("暂不拆部门");
});

it("business prompts expose prior versions and clearly defer their effect to regeneration", () => {
  const html = renderToStaticMarkup(<BusinessPromptEditor prompt={{ version: 2, text: "新关注点",
    versions: [{ version: 1, text: "原关注点" }, { version: 2, text: "新关注点" }] }} onSaved={vi.fn()} />);
  expect(html).toContain("保存，下次生成生效");
  expect(html).toContain("原关注点");
  expect(html).toContain("已有摘要保留原版本");
});

it.each(["owner", "lead"])("%s historical display and export obey home affiliation and preserve public totals", (role) => {
  const state = shared.context.state;
  state.departmentResources = { MKT: ["MRD"], ICE: ["SP&A"], CUSTOM: ["Capex"] };
  const identity = { role, affiliation_sector: "PCMO", affiliation_department: "MKT", department: ["MKT", "ICE"], ownerId: state.initiatives[0].ownerId };
  const model = X.rawData(state, identity, D, "history");
  expect(model.rows).toHaveLength(D.dealers.length);
  expect(model.columns.filter((column) => column.key.startsWith("resource_")).map((column) => column.key))
    .toEqual(["resource_MRD"]);
  expect(X.csv(model)).toContain("历史投资总额");
  expect(X.csv(model)).not.toContain("2025 Capex");
  expect(X.csv(model)).not.toContain("2025 ICE Rebate");
  state.departmentResources = {};
  expect(X.rawData(state, identity, D, "history").columns.filter((column) => column.key.startsWith("resource_")).map((column) => column.key)).toEqual(["resource_MRD", "resource_SP&A"]);
});

it("expense exports fail closed for missing affiliation and honor overrides without inventing API fields", () => {
  const state = shared.context.state;
  state.departmentResources = { MKT: ["MRD"], "PCMO|MKT": ["SP&A"] };
  const home = { role: "admin", affiliation_sector: "PCMO", affiliation_department: "MKT" };
  const columns = identity => X.rawData(state, identity, D, "history").columns
    .filter(column => column.key.startsWith("resource_")).map(column => column.key);
  expect(columns({ role: "admin" })).toEqual([]);
  expect(columns(home)).toEqual(["resource_SP&A"]);
  expect(columns({ ...home, history_resources: [] })).toEqual([]);
  expect(columns({ ...home, history_resources: ["Capex"] })).toEqual([]);
  expect(columns({ ...home, history_resources: ["SP&A", "MRD"] })).toEqual(["resource_SP&A"]);
  state.scenario = "api";
  const data = { ...D, dealers: [{ id: "PUBLIC", history: { resources2025: {}, totalInvestment2025: 100000 } }] };
  const model = X.rawData(state, { ...home, history_resources: ["Capex"] }, data, "history");
  expect(model.columns.some(column => column.key === "resource_Capex")).toBe(false);
  expect(model.rows[0].totalInvestment2025).toBe(100);
});
