import type {
  Allocation,
  Budget,
  Department,
  Insight,
  Quarter,
  Totals,
  TrackingSummary,
  Version,
  WorkspaceState,
} from "./types";

export const makeId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const formatMoney = (n: number) =>
  new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(n);
export const formatPercent = (n: number | null) =>
  n === null ? "未提供" : `${(n * 100).toFixed(1)}%`;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const clone = (state: WorkspaceState): WorkspaceState => structuredClone(state);
const rowsFor = (state: WorkspaceState, id: string) =>
  state.allocations.filter((a) => a.initiativeId === id);
const budgetFor = (state: WorkspaceState, id: string) => {
  const budget = state.budgets.find((b) => b.id === id);
  if (!budget) throw new Error("未找到预算项目");
  return budget;
};
const validMoney = (n: number) => Number.isSafeInteger(n) && n >= 0;
function validateBalance(state: WorkspaceState, budget: Budget) {
  if (
    !validMoney(budget.amount) ||
    !validMoney(budget.pool) ||
    rowsFor(state, budget.id).some((a) => !validMoney(a.amount))
  )
    throw new Error(`${budget.name}：金额必须为非负整数`);
  if (
    sum(rowsFor(state, budget.id).map((a) => a.amount)) + budget.pool !==
    budget.amount
  )
    throw new Error(`${budget.name}：分配与待分配池不等于预算`);
}
function changed(state: WorkspaceState, budget: Budget) {
  budget.completed = false;
  delete state.confirmed[budget.department];
  state.updatedAt = new Date().toISOString();
}
export function totals(state: WorkspaceState, department?: Department): Totals {
  const budgets = state.budgets.filter(
    (b) => !department || b.department === department,
  );
  const ids = new Set(budgets.map((b) => b.id));
  return {
    budget: sum(budgets.map((b) => b.amount)),
    allocated: sum(
      state.allocations
        .filter((a) => ids.has(a.initiativeId))
        .map((a) => a.amount),
    ),
    pool: sum(budgets.map((b) => b.pool)),
    count: budgets.length,
    completed: budgets.filter((b) => b.completed).length,
  };
}
export function getInsights(
  state: WorkspaceState,
  department?: Department,
): Insight[] {
  const insights: Insight[] = [];
  for (const b of state.budgets.filter(
    (b) => !department || b.department === department,
  )) {
    const add = (
      id: string,
      level: Insight["level"],
      title: string,
      text: string,
      rule: string,
    ) =>
      insights.push({
        id: `${b.id}-${id}`,
        level,
        title,
        text,
        initiativeId: b.id,
        department: b.department,
        perspective: "Initiative",
        rule,
      });
    try {
      validateBalance(state, b);
    } catch (e) {
      add(
        "balance",
        "risk",
        "项目金额不平衡",
        (e as Error).message,
        "逐项目：已分配 + 待分配池 = 预算",
      );
    }
    if (b.pool > 0 && !b.poolReason.trim())
      add(
        "pool-reason",
        "risk",
        "待分配池缺少保留原因",
        `${b.name} 仍有 ${formatMoney(b.pool)} 元待分配，请填写保留原因。`,
        "待分配池 > 0 时必须说明原因",
      );
    if (b.amount > 0 && b.pool / b.amount > 0.2)
      add(
        "pool",
        "watch",
        "待分配池较高",
        `${b.name} 尚有 ${formatPercent(b.pool / b.amount)} 待分配。${b.poolReason || "请补充保留原因。"}`,
        "演示阈值：待分配池 > 20%",
      );
    const rows = rowsFor(state, b.id);
    for (const a of rows) {
      if (b.amount > 0 && a.amount / b.amount > 0.45)
        add(
          `concentration-${a.id}`,
          "watch",
          "单一经销商集中度较高",
          `${a.distributor} 占项目总预算 ${formatPercent(a.amount / b.amount)}。`,
          "演示阈值：单一经销商占比 > 45%",
        );
      const delta =
        a.initialAmount === 0
          ? a.amount === 0
            ? 0
            : 1
          : Math.abs(a.amount - a.initialAmount) / a.initialAmount;
      if (delta > 0.3 && !a.explanation.trim())
        add(
          `change-${a.id}`,
          "risk",
          "大额调整缺少说明",
          `${a.distributor} 较初始分配变更超过 30%，请填写调整原因。`,
          "演示阈值：变更 > 30% 且无解释",
        );
    }
    if (rows.some((a) => a.basisLabel.includes("均分")))
      add(
        "equal",
        "info",
        "权重为零，已等额分配",
        "全部适用经销商的有效权重均为零，按整元均分。",
        "仅在全部权重已取得且均为零时适用",
      );
  }
  return insights;
}
function weightFor(
  state: WorkspaceState,
  b: Budget,
  distributor: string,
): number {
  const year = Number(b.period.match(/20\d{2}/)?.[0]);
  if (!year) throw new Error("请设置包含年份的分配期间");
  const field = b.basis === "Vol" ? "vol" : "c3";
  let value: number | undefined;
  if (/forecast|预计|预测/i.test(b.period)) {
    const rows = state.forecast.filter(
      (r) =>
        r.year === year &&
        r.sector === b.sector &&
        r.distributor === distributor,
    );
    if (rows.length > 1) throw new Error(`${distributor}：预计数据重复`);
    value = rows[0]?.[field];
  } else {
    const rows = state.history.filter(
      (r) =>
        r.year === year &&
        r.sector === b.sector &&
        r.resource === b.resource &&
        r.distributor === distributor,
    );
    const quarter = b.period.match(/Q[1-4]/i)?.[0].toUpperCase() ?? "FY";
    const selected = rows.filter((r) => r.quarter === quarter);
    if (selected.length > 1)
      throw new Error(`${distributor}：历史期间数据重复`);
    value = selected[0]?.[field];
    if (value === undefined && quarter === "FY") {
      const quarters = ["Q1", "Q2", "Q3", "Q4"].map((q) =>
        rows.filter((r) => r.quarter === q),
      );
      if (quarters.every((q) => q.length === 1))
        value = sum(quarters.map((q) => q[0][field]));
    }
  }
  if (value === undefined || !Number.isFinite(value) || value < 0)
    throw new Error(
      `${distributor}：${b.period} ${b.basis} 权重缺失或无效，无法分配`,
    );
  return value;
}
export function generateAllocation(
  state: WorkspaceState,
  initiativeId: string,
): WorkspaceState {
  const next = clone(state),
    b = budgetFor(next, initiativeId);
  if (
    !validMoney(b.amount) ||
    !Number.isFinite(b.reservePercent) ||
    b.reservePercent < 0 ||
    b.reservePercent > 100
  )
    throw new Error("预算须为非负整数，保留比例须在 0–100 之间");
  const old = rowsFor(next, initiativeId);
  const names = [
    ...new Set(
      next.applicable
        .filter((a) => a.initiativeId === initiativeId && a.enabled)
        .map((a) => a.distributor),
    ),
  ];
  if (!names.length) throw new Error("请先设置适用经销商");
  const locked = old.filter((a) => a.locked);
  if (locked.some((a) => !names.includes(a.distributor)))
    throw new Error("锁定经销商已不在适用名单，请先解锁");
  if (locked.some((a) => !validMoney(a.amount)))
    throw new Error("锁定金额无效");
  const free = names.filter((n) => !locked.some((a) => a.distributor === n));
  const pool = Math.round((b.amount * b.reservePercent) / 100);
  const available = b.amount - pool - sum(locked.map((a) => a.amount));
  if (available < 0) throw new Error("锁定金额与保留池超过项目预算");
  if (!free.length && available > 0)
    throw new Error("所有经销商均已锁定，无法分配剩余金额");
  const weights = free.map((n) => weightFor(next, b, n));
  const total = sum(weights);
  const exact = weights.map(
    (w) => available * (total === 0 ? 1 / free.length : w / total),
  );
  const amounts = exact.map(Math.floor);
  let tail = available - sum(amounts);
  const order = exact
    .map((v, i) => ({ i, fraction: v - amounts[i] }))
    .sort((a, z) => z.fraction - a.fraction || a.i - z.i);
  for (const item of order) {
    if (tail <= 0) break;
    amounts[item.i] += 1;
    tail--;
  }
  const allocated: Allocation[] = free.map((distributor, i) => ({
    id: old.find((a) => a.distributor === distributor)?.id ?? makeId(),
    initiativeId,
    distributor,
    initialAmount: amounts[i],
    amount: amounts[i],
    locked: false,
    explanation: "",
    basisLabel:
      total === 0
        ? `${b.period} ${b.basis} 全零均分`
        : `${b.period} ${b.basis}`,
  }));
  next.allocations = next.allocations
    .filter((a) => a.initiativeId !== initiativeId)
    .concat(locked, allocated);
  b.pool = pool;
  changed(next, b);
  validateBalance(next, b);
  return next;
}
export function setAllocationAmount(
  state: WorkspaceState,
  rowId: string,
  amount: number,
  explanation?: string,
): WorkspaceState {
  if (!validMoney(amount)) throw new Error("金额必须为非负整数");
  const next = clone(state),
    row = next.allocations.find((a) => a.id === rowId);
  if (!row) throw new Error("未找到分配记录");
  if (row.locked) throw new Error("请先解锁该分配记录");
  const b = budgetFor(next, row.initiativeId);
  validateBalance(next, b);
  const pool = b.pool + row.amount - amount;
  if (pool < 0) throw new Error("调整金额超过当前可用待分配池");
  row.amount = amount;
  if (explanation !== undefined) row.explanation = explanation;
  b.pool = pool;
  changed(next, b);
  return next;
}
export function transferAllocation(
  state: WorkspaceState,
  fromId: string,
  toId: string,
  amount: number,
): WorkspaceState {
  if (!validMoney(amount) || amount === 0)
    throw new Error("转移金额必须为正整数");
  const next = clone(state),
    from = next.allocations.find((a) => a.id === fromId),
    to = next.allocations.find((a) => a.id === toId);
  if (!from || !to || fromId === toId)
    throw new Error("请选择两个不同的分配对象");
  if (from.initiativeId !== to.initiativeId)
    throw new Error("仅支持同一项目内转移");
  if (from.locked || to.locked) throw new Error("锁定记录不能参与转移");
  if (from.amount < amount) throw new Error("转移金额超过来源可用金额");
  const b = budgetFor(next, from.initiativeId);
  validateBalance(next, b);
  from.amount -= amount;
  to.amount += amount;
  from.explanation = `向 ${to.distributor} 转出 ${formatMoney(amount)} 元`;
  to.explanation = `从 ${from.distributor} 转入 ${formatMoney(amount)} 元`;
  changed(next, b);
  return next;
}
export function confirmInitiative(
  state: WorkspaceState,
  id: string,
): WorkspaceState {
  const next = clone(state),
    b = budgetFor(next, id);
  validateBalance(next, b);
  if (!rowsFor(next, id).length) throw new Error("请先生成项目分配");
  if (b.pool > 0 && !b.poolReason.trim())
    throw new Error("请填写待分配池保留原因");
  if (
    getInsights(next).some((i) => i.initiativeId === id && i.level === "risk")
  )
    throw new Error("请先处理项目阻断风险");
  b.completed = true;
  delete next.confirmed[b.department];
  return next;
}
function validateDepartment(state: WorkspaceState, department: Department) {
  const budgets = state.budgets.filter((b) => b.department === department);
  if (!budgets.length) throw new Error("该部门尚无预算项目");
  for (const b of budgets) {
    validateBalance(state, b);
    if (b.pool > 0 && !b.poolReason.trim())
      throw new Error(`${b.name}：请填写待分配池保留原因`);
    if (!b.completed || !rowsFor(state, b.id).length)
      throw new Error(`${b.name} 尚未完成分配确认`);
  }
  if (getInsights(state, department).some((i) => i.level === "risk"))
    throw new Error("请先处理部门阻断风险");
}
export function confirmDepartment(
  state: WorkspaceState,
  department: Department,
): WorkspaceState {
  validateDepartment(state, department);
  const next = clone(state);
  next.confirmed[department] = true;
  return next;
}
export function publishVersion(
  state: WorkspaceState,
  note: string,
): WorkspaceState {
  if (!state.budgets.length) throw new Error("没有可发布的预算");
  for (const dept of new Set(state.budgets.map((b) => b.department))) {
    validateDepartment(state, dept);
    if (!state.confirmed[dept]) throw new Error(`${dept} 尚未确认`);
  }
  const next = clone(state);
  next.versions.unshift({
    id: makeId(),
    name: `V${next.versions.length + 1}`,
    createdAt: new Date().toISOString(),
    note,
    budgets: structuredClone(next.budgets),
    allocations: structuredClone(next.allocations),
    forecast: structuredClone(next.forecast),
  });
  next.confirmed = {};
  return next;
}
export function trackingSummary(
  state: WorkspaceState,
  version: Version,
  quarter: Quarter,
  department?: Department,
): TrackingSummary {
  const budgets = version.budgets.filter(
      (b) => !department || b.department === department,
    ),
    ids = new Set(budgets.map((b) => b.id));
  const allocations = version.allocations.filter((a) =>
    ids.has(a.initiativeId),
  );
  const rows = allocations.map((a) =>
    state.tracking.filter(
      (t) =>
        t.initiativeId === a.initiativeId &&
        t.distributor === a.distributor &&
        t.quarter === quarter,
    ),
  );
  const valid = rows.map((r) =>
    r.length === 1 &&
    Number.isFinite(r[0].actualSpendYtd) &&
    r[0].actualSpendYtd >= 0
      ? r[0]
      : undefined,
  );
  const budget = sum(budgets.map((b) => b.amount)),
    actual = sum(valid.map((r) => r?.actualSpendYtd ?? 0));
  const completeForecast =
    allocations.length > 0 &&
    valid.every(
      (r) =>
        r &&
        r.forecastSpend !== null &&
        Number.isFinite(r.forecastSpend) &&
        r.forecastSpend >= 0,
    );
  const forecast = completeForecast
    ? sum(valid.map((r) => r!.forecastSpend!))
    : null;
  return {
    budget,
    allocated: sum(allocations.map((a) => a.amount)),
    pool: sum(budgets.map((b) => b.pool)),
    actual,
    remaining: budget - actual,
    utilization: budget > 0 ? actual / budget : null,
    forecast,
    variance: forecast === null ? null : forecast - budget,
    missing: valid.filter((r) => !r).length,
  };
}
