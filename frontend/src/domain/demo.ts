import type { Budget, WorkspaceState } from "./types";
import { generateAllocation } from "./engine";

export function createEmptyState(): WorkspaceState {
  return {
    schemaVersion: 1,
    dataMode: "user",
    budgets: [],
    history: [],
    forecast: [],
    applicable: [],
    allocations: [],
    tracking: [],
    confirmed: {},
    versions: [],
    audit: [],
    updatedAt: new Date().toISOString(),
  };
}

export function createDemoState(): WorkspaceState {
  let state = createEmptyState();
  state.dataMode = "demo";
  const configs: [
    Budget["sector"],
    Budget["department"],
    Budget["resource"],
    string,
    number,
  ][] = [
    ["PCMO", "MKT", "SP&A BTL", "乘用车渠道推广", 1800000],
    ["CRTO", "MKT", "MRD", "商用车市场拓展", 1200000],
    ["B2B", "MKT", "Commission Fee", "工业客户渠道支持", 900000],
    ["PCMO", "ICE", "ICE Rebate", "乘用车经销商激励", 2400000],
    ["CRTO", "ICE", "ICE Rebate", "商用车增长激励", 1500000],
    ["OEM", "Capex", "Capex", "主机厂服务能力建设", 1600000],
    ["B2B", "Capex", "Capex", "工业渠道设施投入", 1100000],
  ];
  const names = [
    "华东示例渠道",
    "华南示例渠道",
    "华北示例渠道",
    "西部示例渠道",
  ];
  for (const [
    index,
    [sector, department, resource, name, amount],
  ] of configs.entries()) {
    const id = `demo-budget-${index + 1}`;
    state.budgets.push({
      id,
      sector,
      department,
      resource,
      name,
      amount,
      pool: amount,
      poolReason: "预留新客户与下半年市场机会，待明确名单后分配。",
      basis: index % 2 ? "C3" : "Vol",
      period: "2026-FY",
      reservePercent: index === 2 ? 25 : 10,
      completed: false,
    });
    for (const [i, distributor] of names.entries()) {
      state.applicable.push({
        id: `app-${index}-${i}`,
        initiativeId: id,
        distributor,
        source: "合成演示名单",
        enabled: true,
      });
      const vol = (4 - i) * 12000 + index * 500,
        c3 = (4 - i) * 800000 + index * 17000;
      const key = `${sector}-${resource}-${i}`;
      if (!state.history.some((h) => h.id === `${key}-FY`)) {
        state.history.push({
          id: `${key}-FY`,
          year: 2026,
          quarter: "FY",
          sector,
          distributor,
          resource,
          vol,
          c3,
          spend: (4 - i) * 160000,
        });
        for (const [qIndex, quarter] of (
          ["Q1", "Q2", "Q3", "Q4"] as const
        ).entries())
          state.history.push({
            id: `${key}-${quarter}`,
            year: 2026,
            quarter,
            sector,
            distributor,
            resource,
            vol: vol * [0.2, 0.25, 0.25, 0.3][qIndex],
            c3: c3 * [0.2, 0.25, 0.25, 0.3][qIndex],
            spend: (4 - i) * 40000,
          });
      }
      if (
        !state.forecast.some(
          (f) => f.sector === sector && f.distributor === distributor,
        )
      )
        state.forecast.push({
          id: `forecast-${sector}-${i}`,
          year: 2027,
          sector,
          distributor,
          vol: Math.round(vol * 1.08),
          c3: Math.round(c3 * 1.05),
        });
    }
  }
  for (const b of state.budgets.slice(0, 5))
    state = generateAllocation(state, b.id);
  state.budgets[0].completed = true;
  state.budgets[1].completed = true;
  for (const [index, a] of state.allocations.entries()) {
    for (const [qIndex, quarter] of (["Q1", "Q2"] as const).entries()) {
      if (index === 3 && quarter === "Q2") continue;
      state.tracking.push({
        id: `track-${a.id}-${quarter}`,
        initiativeId: a.initiativeId,
        distributor: a.distributor,
        quarter,
        actualSpendYtd: Math.round(a.amount * (qIndex === 0 ? 0.21 : 0.46)),
        actualC3: null,
        forecastSpend: index === 2 ? null : Math.round(a.amount * 1.03),
        reason: "合成演示 YTD 快照；C3 尚无可比项目归因。",
      });
    }
  }
  state.audit.push({
    id: "demo-init",
    time: new Date().toISOString(),
    text: "载入合成演示数据：2026 FY / 季度、2027 预计均为示例，不代表客户实际。",
  });
  return state;
}
