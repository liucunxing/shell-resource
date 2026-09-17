import { describe, expect, it } from "vitest";
import { createDemoState } from "../src/domain/demo";
import {
  applyDataset,
  datasetRows,
  parseDataset,
  validateRows,
} from "../src/domain/excel";
import { generateAllocation } from "../src/domain/engine";
describe("Excel 数据边界", () => {
  it("拒绝空白、非法数字和重复预算，原状态不变", () => {
    const s = createDemoState();
    const before = JSON.stringify(s);
    const rows = datasetRows(s, "budgets");
    rows[0].PlanBudget = "abc";
    rows.push({ ...rows[0], PlanBudget: "" });
    expect(validateRows(rows, "budgets", s).join(" ")).toContain("重复记录");
    expect(() => applyDataset(s, "budgets", rows)).toThrow("非负有效数字");
    expect(JSON.stringify(s)).toBe(before);
  });
  it("拒绝跨项目适用名单与跨部门调整", () => {
    const s = createDemoState();
    const b = s.budgets[0],
      other = s.budgets.find((x) => x.id !== b.id)!;
    const r = {
      Sector: other.sector,
      Department: other.department,
      Initiative: other.name,
      Distributor: "测试经销商",
      Source: "手工",
    };
    expect(
      validateRows([r], "applicable", s, { initiativeId: b.id }).join(" "),
    ).toContain("其他项目");
    expect(
      validateRows([{ ...r, Department: "ICE" }], "adjust", s, {
        department: "MKT",
      }).join(" "),
    ).toContain("其他部门");
  });
  it("导入历史撤销分配与确认，保留正式版本", () => {
    let s = createDemoState();
    s = generateAllocation(s, s.budgets[0].id);
    s.confirmed.MKT = true;
    const versions = s.versions;
    const next = applyDataset(s, "history", datasetRows(s, "history"));
    expect(next.allocations).toHaveLength(0);
    expect(next.confirmed.MKT).toBeUndefined();
    expect(next.versions).toBe(versions);
    expect(next.dataMode).toBe("user");
    expect(s.allocations.length).toBeGreaterThan(0);
  });
  it("调整表要求完整记录且逐项目守恒", () => {
    let s = createDemoState();
    s = generateAllocation(s, s.budgets[0].id);
    const department = s.budgets[0].department;
    const rows = datasetRows(s, "adjust", { department });
    rows[0].PlanAmount = Number(rows[0].PlanAmount) + 1;
    rows[0].Explanation = "测试";
    expect(validateRows(rows, "adjust", s, { department }).join(" ")).toContain(
      "必须等于项目预算",
    );
  });
  it("明确拒绝旧版 xls", async () => {
    const result = await parseDataset(
      { name: "data.xls", size: 20 } as File,
      "history",
      createDemoState(),
    );
    expect(result.errors[0]).toContain(".xls 暂不支持");
  });
  it("tracking 必须有正式版本且使用合法季度", () => {
    const s = createDemoState();
    s.versions = [];
    expect(validateRows([{ Quarter: "FY" }], "tracking", s)[0]).toContain(
      "尚无正式版本",
    );
  });
});
