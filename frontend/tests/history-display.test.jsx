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
  expect(X.csv(model)).toContain('"Sector 业务线"');
});

it("labels multi-sector Lead history and global administrator/management history correctly", () => {
  const state = E.createState(D, "working");
  const model = X.rawData(state, { role: "lead", department: "MKT", sectors: ["PCMO", "CRTO"] }, D, "history");
  expect(model.scopeLabel).toContain("PCMO / CRTO");
  expect(model.notes).toContain("只展示当前用户所在业务线的经销商数据。");
  for (const role of ["admin", "management"]) {
    const global = X.rawData(state, { role }, D, "history");
    expect(global.scopeLabel).toContain("全业务线");
    expect(global.notes).toContain("管理员与总负责人展示全部业务线的经销商数据。");
  }
});
