import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import E from "../src/workbench/domain/engine.js";
import X from "../src/workbench/domain/explore.js";
import D from "../src/workbench/domain/demo-data.json";
import { ManagementPage, DepartmentPage } from "../src/workbench/pages/OverviewPages.jsx";
import { EditorPage } from "../src/workbench/pages/EditorPage.jsx";

const shared = vi.hoisted(() => ({ context: null }));
vi.mock("../src/workbench/WorkbenchContext.jsx", () => ({ useWorkbench: () => shared.context }));

beforeEach(() => {
  const state = E.createState(D, "working");
  const identity = { role: "admin", key: "admin", email: "admin@example.test", department: [] };
  shared.context = { state, identity, data: D, view: E.selectView(state, identity), apiMode: true,
    initiativeId: state.initiatives[0].id, dirtyIds: new Set(), savedForSyncIds: new Set(),
    editorOperations: {}, directoryStatus: {}, notify: vi.fn(), loadDistributorDirectory: vi.fn() };
});

it("management overview follows the customer V19 readonly board", () => {
  const html = renderToStaticMarkup(<ManagementPage />);
  expect(html).toContain("全局投资看板");
  expect(html).toContain("只读，基于部门已确认方案");
  expect(html).toContain("总盘 · 资源大类");
  expect(html).toContain("集中度");
  expect(html).toContain("叠加到经销商");
  expect(html).not.toContain("经销商明细");
  expect(html).not.toContain("当前工作稿（含未同步调整）");
  expect(html).not.toContain("查看 / 调整");
  const editor = renderToStaticMarkup(<EditorPage />);
  expect(editor).not.toContain(">保存草稿<");
  expect(editor).not.toContain(">提交当前方案<");
  expect(editor).not.toContain("可继续修改");
});

it.each(["owner", "lead"])("keeps dealer details only in the Owner portfolio (%s)", role => {
  const { state } = shared.context;
  const first = state.initiatives[0];
  const identity = { role, key: role, email: "user@example.test", ownerId: first.ownerId, department: [first.department] };
  shared.context.identity = identity;
  shared.context.view = E.selectView(state, identity);
  shared.context.page = role === "owner" ? "portfolio" : "department";
  const html = renderToStaticMarkup(<DepartmentPage />);
  expect(html.includes("经销商明细")).toBe(role === "owner");
  expect(html.includes("叠加到经销商")).toBe(role === "lead");
});

it("management sees all four expense columns for an explicitly authorized Sector", () => {
  const identity = { role: "management", sectors: ["B2B"], history_resources: [] };
  const columns = (user) => X.rawData(shared.context.state, user, D, "history").columns
    .filter(column => column.key.startsWith("resource_")).map(column => column.key);
  expect(columns(identity)).toEqual(["resource_MRD", "resource_SP&A", "resource_ICE Rebate", "resource_Capex"]);
  expect(columns({ ...identity, sectors: [] })).toEqual([]);
});

it.each(["owner", "lead"])("%s historical display and export obey authorized departments and preserve public totals", (role) => {
  const state = shared.context.state;
  state.departmentResources = { MKT: ["MRD"], ICE: ["SP&A"], CUSTOM: ["Capex"] };
  const identity = { role, affiliation_sector: "PCMO", affiliation_department: "MKT", department: ["MKT", "ICE"], ownerId: state.initiatives[0].ownerId };
  const model = X.rawData(state, identity, D, "history");
  expect(model.rows).toHaveLength(D.dealers.length);
  expect(model.columns.filter((column) => column.key.startsWith("resource_")).map((column) => column.key))
    .toEqual(["resource_MRD", "resource_SP&A", "resource_ICE Rebate"]);
  expect(X.csv(model)).toContain("历史投资总额");
  expect(X.csv(model)).not.toContain("2025 Capex");
  expect(X.csv(model)).toContain("ICE Rebate");
  state.departmentResources = {};
  expect(X.rawData(state, identity, D, "history").columns.filter((column) => column.key.startsWith("resource_")).map((column) => column.key)).toEqual(["resource_MRD", "resource_SP&A", "resource_ICE Rebate"]);
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
