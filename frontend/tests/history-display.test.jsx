import { expect, it } from "vitest";
import X from "../src/workbench/domain/explore.js";
import E from "../src/workbench/domain/engine.js";
import D from "../src/workbench/domain/demo-data.json";

it("puts Sector first and displays/exports Yield with one decimal without rounding the source", () => {
  const data = { ...D, dealers: D.dealers.map((dealer, index) => index === 0 ? { ...dealer, sector: "PCMO", history: { ...dealer.history, yield: 6.769 } } : dealer) };
  const model = X.rawData(E.createState(data, "working"), { role: "admin" }, data, "history");
  expect(model.columns[0].key).toBe("sector");
  expect(model.rows[0].sector).toBe("PCMO");
  expect(model.rows[0].yield).toBe(6.769);
  expect(X.renderRaw(model)).toContain("6.8</td>");
  expect(X.csv(model)).toContain('"6.8"');
  expect(model.columns[0].label).toBe("业务线");
  expect(X.csv(model)).toContain('"业务线"');
});

it("labels multi-sector Lead history and global administrator/management history correctly", () => {
  const state = E.createState(D, "working");
  const model = X.rawData(state, { role: "lead", department: "MKT", sectors: ["PCMO", "CRTO"] }, D, "history");
  expect(model.scopeLabel).toContain("全部经销商历史");
  expect(model.columns.filter((column) => column.key.startsWith("resource_")).map((column) => column.key)).toEqual(["resource_MRD", "resource_SP&A"]);
  for (const role of ["admin", "management"]) {
    const global = X.rawData(state, { role }, D, "history");
    expect(global.scopeLabel).toContain("全部经销商历史");
    expect(global.columns.some((column) => column.label.includes("总资源"))).toBe(false);
  }
});

it("shows and exports both sectors for one code and selects reference history by sector", () => {
  const data = { ...D, dealers: [
    { id: "12088918", name: "Dealer", sector: "PCMO", history: { vol2025: 821370.19, yield: 8 } },
    { id: "12088918", name: "Dealer", sector: "CRTO", history: { vol2025: 160384.05, yield: 4.33 } },
  ] };
  const state = E.createState(D, "working");
  const identity = { role: "admin" };
  const model = X.rawData(state, identity, data, "history");
  expect(model.rows.map((row) => row.sector)).toEqual(["PCMO", "CRTO"]);
  expect(model.basisLabel).toContain("1 家经销商 / 2 条业务线记录");
  expect(X.csv(model)).toContain('"PCMO","12088918"');
  expect(X.csv(model)).toContain('"CRTO","12088918"');
  expect(X.historyReference(state, identity, data, "12088918", "PCMO").yield).toBe(8);
  expect(X.historyReference(state, identity, data, "12088918", "CRTO").yield).toBe(4.33);
  expect(() => X.historyReference(state, identity, data, "12088918")).toThrow(/选择业务线/);
});

it("uses the matching sector in calculated Insight instead of the last history row", () => {
  const state = E.createState(D, "working");
  const item = state.initiatives.find((initiative) => initiative.department === "MKT");
  const dealerId = item.rows[0].dealerId;
  const source = { ...D, dealers: [
    { id: dealerId, sector: item.sector, history: { yield: 7 } },
    { id: dealerId, sector: "ANOTHER-SECTOR", history: { yield: 999999 } },
  ] };
  const result = E.generateInsight(state, `initiative:${item.id}`, {
    role: "owner", ownerId: item.ownerId, department: item.department,
  }, { data: source });
  const low = result.items.find((entry) => entry.key === "low_yield");
  expect(low.evidence).toContain("为 7");
  expect(low.evidence).not.toContain("999,999");
});
