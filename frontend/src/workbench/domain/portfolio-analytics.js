const number = (value) =>
  value === null || value === undefined || value === ""
    ? null
    : Number.isFinite(Number(value)) ? Number(value) : null;

export function dealerHistory(dealers, dealerId, sector) {
  const matches = (dealers || []).filter(
    (dealer) => String(dealer.id) === String(dealerId) && (!sector || dealer.sector === sector),
  );
  return matches.length === 1 ? matches[0] : matches.find((dealer) => dealer.sector === sector) || null;
}

export function historyValue(dealer, basis = "c3", period = "2025") {
  const history = dealer?.history || {};
  const key = basis === "vol"
    ? period === "2026Ytd" ? "vol2026Ytd" : "vol2025"
    : period === "2026Ytd" ? "c32026Ytd" : "c32025";
  return number(history[key]);
}

export function portfolioRows(items, dealers, basis = "c3", period = "2025") {
  const rows = new Map();
  for (const initiative of items || []) {
    for (const allocation of initiative.rows || []) {
      const dealer = dealerHistory(dealers, allocation.dealerId, initiative.sector);
      const key = `${initiative.sector || ""}:${allocation.dealerId}`;
      const current = rows.get(key) || {
        key,
        id: String(allocation.dealerId),
        code: dealer?.code || allocation.dealerCode || String(allocation.dealerId),
        name: dealer?.name || "—",
        sector: initiative.sector || dealer?.sector || "—",
        sd: dealer?.sd || "未配置 SD",
        rsm: dealer?.rsm || "未配置 RSM",
        status: dealer?.status || "—",
        amount: 0,
        initiatives: new Set(),
        resourceTypes: new Set(),
        notes: [],
        metric: historyValue(dealer, basis, period),
        history: dealer?.history || {},
      };
      current.amount += Number(allocation.amount) || 0;
      current.initiatives.add(initiative.name);
      current.resourceTypes.add(initiative.resourceType);
      if (allocation.note) current.notes.push(allocation.note);
      rows.set(key, current);
    }
  }
  return [...rows.values()];
}

export function concentration(rows, topPercent = 20) {
  const eligible = rows
    .filter((row) => row.metric !== null)
    .sort((left, right) =>
      right.amount - left.amount || right.metric - left.metric || left.id.localeCompare(right.id),
    );
  if (!eligible.length) return null;
  const n = Math.max(1, Math.round(eligible.length * topPercent / 100));
  const top = eligible.slice(0, n);
  const amountTotal = eligible.reduce((sum, row) => sum + row.amount, 0);
  const metricTotal = eligible.reduce((sum, row) => sum + Math.max(0, row.metric), 0);
  const amountShare = amountTotal
    ? top.reduce((sum, row) => sum + row.amount, 0) / amountTotal * 100
    : 0;
  const metricShare = metricTotal
    ? top.reduce((sum, row) => sum + Math.max(0, row.metric), 0) / metricTotal * 100
    : 0;
  return { count: eligible.length, n, top, amountShare, metricShare, gap: amountShare - metricShare };
}

export function dealerDeviations(rows) {
  const eligible = rows.filter((row) => row.metric !== null);
  const amountTotal = eligible.reduce((sum, row) => sum + row.amount, 0);
  const metricTotal = eligible.reduce((sum, row) => sum + Math.max(0, row.metric), 0);
  return eligible.map((row) => {
    const amountShare = amountTotal ? row.amount / amountTotal * 100 : 0;
    const metricShare = metricTotal ? Math.max(0, row.metric) / metricTotal * 100 : 0;
    return { ...row, amountShare, metricShare, gap: amountShare - metricShare };
  }).sort((left, right) => right.gap - left.gap || right.amount - left.amount);
}

export function groupSummary(rows, allDealers, groupBy = "sd") {
  const groups = new Map();
  const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0);
  const totalMetric = rows.reduce((sum, row) => sum + Math.max(0, row.metric || 0), 0);
  for (const row of rows) {
    const key = row[groupBy] || `未配置 ${groupBy.toUpperCase()}`;
    const group = groups.get(key) || { key, allocated: new Set(), amount: 0, metric: 0 };
    group.allocated.add(row.key);
    group.amount += row.amount;
    group.metric += Math.max(0, row.metric || 0);
    groups.set(key, group);
  }
  const masterCounts = new Map();
  for (const dealer of allDealers || []) {
    const key = dealer[groupBy] || `未配置 ${groupBy.toUpperCase()}`;
    masterCounts.set(key, (masterCounts.get(key) || 0) + 1);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    allocatedCount: group.allocated.size,
    totalCount: Math.max(masterCounts.get(group.key) || 0, group.allocated.size),
    amountShare: totalAmount ? group.amount / totalAmount * 100 : 0,
    metricShare: totalMetric ? group.metric / totalMetric * 100 : 0,
    gap: totalAmount && totalMetric
      ? group.amount / totalAmount * 100 - group.metric / totalMetric * 100
      : null,
  })).sort((left, right) => right.amount - left.amount);
}

export function level(gap, yellow = 5, red = 10) {
  if (gap === null || !Number.isFinite(gap)) return "none";
  if (gap > red) return "bad";
  if (gap > yellow) return "warn";
  return "good";
}
