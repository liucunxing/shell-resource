import { describe, expect, it } from "vitest";
import { createDemoState } from "../src/domain/demo";
import {
  confirmDepartment,
  confirmInitiative,
  formatMoney,
  formatPercent,
  generateAllocation,
  getInsights,
  publishVersion,
  setAllocationAmount,
  trackingSummary,
  transferAllocation,
} from "../src/domain/engine";
import type { WorkspaceState } from "../src/domain/types";

function ready(): WorkspaceState {
  let state = createDemoState();
  for (const b of state.budgets)
    state = confirmInitiative(generateAllocation(state, b.id), b.id);
  for (const department of ["MKT", "ICE", "Capex"] as const)
    state = confirmDepartment(state, department);
  return state;
}
describe("预算分配业务约束", () => {
  it("有池无保留原因时，风险提示并阻止各级确认与发布", () => {
    const state = ready(),
      budget = state.budgets[0];
    budget.poolReason = "   ";
    expect(
      getInsights(state).some(
        (i) =>
          i.initiativeId === budget.id &&
          i.level === "risk" &&
          i.id.endsWith("pool-reason"),
      ),
    ).toBe(true);
    expect(() => confirmInitiative(state, budget.id)).toThrow(/保留原因/);
    expect(() => confirmDepartment(state, budget.department)).toThrow(
      /保留原因/,
    );
    expect(() => publishVersion(state, "测试")).toThrow(/保留原因/);
    budget.poolReason = "待下半年客户名单明确";
    expect(() => publishVersion(state, "测试")).not.toThrow();
  });
  it("缺失比例使用明确占位，负金额差异可以展示", () => {
    expect(formatPercent(null)).toBe("未提供");
    expect(formatMoney(-1234)).toBe("-1,234");
  });
  it("小额预算整元分配，尾差不会生成负数，项目金额守恒", () => {
    let state = createDemoState();
    const b = state.budgets[0];
    b.amount = 2;
    b.reservePercent = 0;
    state = generateAllocation(state, b.id);
    const rows = state.allocations.filter((a) => a.initiativeId === b.id);
    expect(rows.every((a) => Number.isInteger(a.amount) && a.amount >= 0)).toBe(
      true,
    );
    expect(rows.reduce((s, a) => s + a.amount, 0)).toBe(2);
  });
  it("重算保留锁定金额，缺FY不能偷偷均分，完整季度允许汇总", () => {
    let state = createDemoState();
    const b = state.budgets[0];
    const row = state.allocations.find((a) => a.initiativeId === b.id)!;
    row.locked = true;
    state = generateAllocation(state, b.id);
    expect(state.allocations.find((a) => a.id === row.id)?.amount).toBe(
      row.amount,
    );
    state.history = state.history.filter((h) => h.quarter !== "FY");
    expect(() => generateAllocation(state, b.id)).not.toThrow();
    state.history = state.history.filter((h) => h.quarter !== "Q4");
    expect(() => generateAllocation(state, b.id)).toThrow(/权重缺失/);
  });
  it("全零有效权重才允许均分，部分缺失阻断", () => {
    const state = createDemoState(),
      b = state.budgets[0];
    state.history.forEach((h) => {
      h.vol = 0;
    });
    const next = generateAllocation(state, b.id);
    expect(
      next.allocations
        .filter((a) => a.initiativeId === b.id)
        .every((a) => a.basisLabel.includes("均分")),
    ).toBe(true);
    state.history = state.history.filter(
      (h) => h.distributor !== "华南示例渠道",
    );
    expect(() => generateAllocation(state, b.id)).toThrow();
  });
  it("同项目原子转移，锁定与跨项目操作拒绝，原状态不变", () => {
    const state = createDemoState(),
      a = state.allocations[0],
      b = state.allocations[1];
    const next = transferAllocation(state, a.id, b.id, 100);
    expect(next.allocations[0].amount).toBe(a.amount - 100);
    expect(next.allocations[1].amount).toBe(b.amount + 100);
    expect(state.allocations[0].amount).toBe(a.amount);
    expect(() =>
      transferAllocation(state, a.id, state.allocations[4].id, 100),
    ).toThrow(/同一项目/);
    a.locked = true;
    expect(() => transferAllocation(state, a.id, b.id, 100)).toThrow(/锁定/);
  });
  it("手工金额拒绝负数、小数和超池，调整撤销确认", () => {
    const state = ready(),
      a = state.allocations[0];
    expect(() => setAllocationAmount(state, a.id, -1)).toThrow();
    expect(() => setAllocationAmount(state, a.id, 1.5)).toThrow();
    expect(() => setAllocationAmount(state, a.id, 999999999)).toThrow();
    const next = setAllocationAmount(state, a.id, a.amount - 1);
    expect(next.confirmed.MKT).toBeUndefined();
    expect(next.budgets.find((b) => b.id === a.initiativeId)?.completed).toBe(
      false,
    );
  });
  it("不能用其他项目尾差抵消项目不平衡", () => {
    const state = ready();
    state.budgets[0].pool += 1;
    state.budgets[1].pool -= 1;
    expect(() => confirmDepartment(state, "MKT")).toThrow(/不等于预算/);
    expect(() => publishVersion(state, "")).toThrow();
  });
  it("发布深拷贝正式版本，后续修改不污染且清空确认", () => {
    const state = publishVersion(ready(), "正式基线");
    const before = state.versions[0].allocations[0].amount;
    state.allocations[0].amount = 3;
    state.budgets[0].amount = 4;
    expect(state.versions[0].allocations[0].amount).toBe(before);
    expect(state.versions[0].budgets[0].amount).not.toBe(4);
    expect(state.confirmed).toEqual({});
  });
  it("Tracking选取当季YTD，不叠加Q1；预算包含池，缺失预测为null", () => {
    const state = publishVersion(ready(), "基线"),
      version = state.versions[0];
    const result = trackingSummary(state, version, "Q2");
    expect(result.actual).toBe(
      state.tracking
        .filter((t) => t.quarter === "Q2")
        .reduce((s, t) => s + t.actualSpendYtd, 0),
    );
    expect(result.budget).toBe(
      version.budgets.reduce((s, b) => s + b.amount, 0),
    );
    expect(result.missing).toBeGreaterThan(0);
    expect(result.forecast).toBeNull();
    expect(result.variance).toBeNull();
  });
});
