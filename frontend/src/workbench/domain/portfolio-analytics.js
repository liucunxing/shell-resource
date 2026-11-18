import { aggregateHistoryPhasing, historyInvestment } from "./dealer-history";

const number = (value) =>
  value === null || value === undefined || value === ""
    ? null
    : Number.isFinite(Number(value))
      ? Number(value)
      : null;

export function dealerHistory(dealers, dealerId, sector) {
  const matches = (dealers || []).filter(
    (dealer) =>
      String(dealer.id) === String(dealerId) &&
      (!sector || dealer.sector === sector),
  );
  return matches.length === 1
    ? matches[0]
    : matches.find((dealer) => dealer.sector === sector) || null;
}

export function historyValue(dealer, basis = "c3", period = "2025") {
  const history = dealer?.history || {};
  const key =
    basis === "vol"
      ? period === "2026Ytd"
        ? "vol2026Ytd"
        : "vol2025"
      : period === "2026Ytd"
        ? "c32026Ytd"
        : "c32025";
  return number(history[key]);
}

export function portfolioRows(items, dealers, basis = "c3", period = "2025") {
  const rows = new Map();
  for (const initiative of items || []) {
    const allocations = new Map(
      (initiative.rows || []).map((row) => [String(row.dealerId), row]),
    );
    // Selection, not positive investment, defines the history denominator.
    const selectedIds = Array.isArray(initiative.selected)
      ? initiative.selected.map(String)
      : [...allocations.keys()];
    for (const dealerId of new Set(selectedIds)) {
      const allocation = allocations.get(dealerId) || { dealerId, amount: 0 };
      const dealer = dealerHistory(
        dealers,
        allocation.dealerId,
        initiative.sector,
      );
      const key = `${initiative.sector || ""}:${allocation.dealerId}`;
      const current = rows.get(key) || {
        key,
        id: String(allocation.dealerId),
        code:
          dealer?.code || allocation.dealerCode || String(allocation.dealerId),
        name: dealer?.name || "—",
        sector: initiative.sector || dealer?.sector || "—",
        sd: allocation.sd || dealer?.sd || "未配置 SD",
        rsm: allocation.rsm || dealer?.rsm || "未配置 RSM",
        status: dealer?.status || "—",
        amount: 0,
        initiatives: new Set(),
        initiativeSources: [],
        resourceTypes: new Set(),
        notes: [],
        metric: historyValue(dealer, basis, period),
        hasHistory:
          historyValue(dealer, "vol", period) > 0 ||
          historyValue(dealer, "c3", period) > 0,
        history: dealer?.history || {},
      };
      current.amount += Number(allocation.amount) || 0;
      current.initiatives.add(initiative.name);
      current.initiativeSources.push({
        id: String(initiative.id),
        key: String(initiative.initiativeKey || initiative.id),
        name: initiative.name,
        owner: initiative.ownerName || initiative.ownerId || "—",
        amount: Number(allocation.amount) || 0,
      });
      current.resourceTypes.add(initiative.resourceType);
      if (allocation.note) current.notes.push(allocation.note);
      rows.set(key, current);
    }
  }
  return [...rows.values()];
}

// V17/V19 mval: clip only analytical output, never the source history.
export const analyticalOutput = (value) => Math.max(0, number(value) || 0);

export function rankedConcentrationRows(rows) {
  return rows
    .filter((row) => row.hasHistory !== false && number(row.metric) !== null)
    .sort(
      (left, right) =>
        Math.round(right.amount / 100) - Math.round(left.amount / 100) ||
        analyticalOutput(right.metric) - analyticalOutput(left.metric) ||
        String(left.code || left.id).localeCompare(
          String(right.code || right.id),
        ),
    );
}

export function concentration(rows, topPercent = 20) {
  const eligible = rankedConcentrationRows(rows);
  if (!eligible.length) return null;
  const n = Math.max(1, Math.round((eligible.length * topPercent) / 100));
  const top = eligible.slice(0, n);
  const amountTotal = eligible.reduce((sum, row) => sum + row.amount, 0);
  const metricTotal = eligible.reduce(
    (sum, row) => sum + analyticalOutput(row.metric),
    0,
  );
  if (amountTotal <= 0 || metricTotal <= 0) return null;
  const amountShare = amountTotal
    ? (top.reduce((sum, row) => sum + row.amount, 0) / amountTotal) * 100
    : 0;
  const metricShare = metricTotal
    ? (top.reduce((sum, row) => sum + analyticalOutput(row.metric), 0) /
        metricTotal) *
      100
    : 0;
  return {
    count: eligible.length,
    n,
    top,
    amountShare,
    metricShare,
    gap: amountShare - metricShare,
  };
}

export function dealerDeviations(rows) {
  const eligible = rows.filter(
    (row) => row.hasHistory !== false && row.metric !== null,
  );
  const amountTotal = eligible.reduce((sum, row) => sum + row.amount, 0);
  const metricTotal = eligible.reduce(
    (sum, row) => sum + analyticalOutput(row.metric),
    0,
  );
  return eligible
    .map((row) => {
      const amountShare = amountTotal ? (row.amount / amountTotal) * 100 : 0;
      const metricShare = metricTotal
        ? (analyticalOutput(row.metric) / metricTotal) * 100
        : 0;
      return {
        ...row,
        amountShare,
        metricShare,
        gap: amountShare - metricShare,
      };
    })
    .sort((left, right) => right.gap - left.gap || right.amount - left.amount);
}

const completeSum = (values) =>
  values.length && values.every((value) => number(value) !== null)
    ? values.reduce((sum, value) => sum + number(value), 0)
    : null;

export function groupSummary(
  rows,
  allDealers,
  groupBy = "sd",
  period = "2025",
  { includeMasterGroups = false } = {},
) {
  const groups = new Map();
  const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0);
  const totalMetric = rows.reduce(
    (sum, row) => sum + analyticalOutput(row.metric),
    0,
  );
  for (const row of rows) {
    const key = row[groupBy] || `未配置 ${groupBy.toUpperCase()}`;
    const group = groups.get(key) || {
      key,
      allocated: new Set(),
      selected: new Set(),
      rows: [],
      amount: 0,
      metric: 0,
    };
    group.selected.add(row.key);
    if (row.amount > 0) group.allocated.add(row.key);
    group.rows.push(row);
    group.amount += row.amount;
    group.metric += analyticalOutput(row.metric);
    groups.set(key, group);
  }
  const masterCounts = new Map();
  const scopedSectors = new Set(rows.map((row) => row.sector));
  const seenDealers = new Set();
  for (const dealer of allDealers || []) {
    if (
      !includeMasterGroups &&
      dealer.sector &&
      !scopedSectors.has(dealer.sector)
    )
      continue;
    const identity = `${dealer.sector || ""}:${dealer.id}`;
    if (seenDealers.has(identity)) continue;
    seenDealers.add(identity);
    const key = dealer[groupBy] || `未配置 ${groupBy.toUpperCase()}`;
    masterCounts.set(key, (masterCounts.get(key) || 0) + 1);
  }
  if (includeMasterGroups)
    for (const key of masterCounts.keys()) {
      if (!groups.has(key))
        groups.set(key, {
          key,
          allocated: new Set(),
          selected: new Set(),
          rows: [],
          amount: 0,
          metric: 0,
        });
    }
  const metricComplete = rows.every((row) => number(row.metric) !== null);
  return [...groups.values()]
    .map((group) => {
      const metric = completeSum(group.rows.map((row) => row.metric));
      const analysisSum = (basis) => {
        const values = group.rows.map((row) =>
          historyValue({ history: row.history }, basis, period),
        );
        return values.every((value) => value !== null)
          ? values.reduce(
              (sum, value, index) =>
                sum +
                (group.rows[index].hasHistory === false
                  ? 0
                  : analyticalOutput(value)),
              0,
            )
          : null;
      };
      const analyticalVol = analysisSum("vol"),
        analyticalC3 = analysisSum("c3");
      const historicalVol = completeSum(
        group.rows.map(
          (row) => row.history?.[period === "2025" ? "vol2025" : "vol2026Ytd"],
        ),
      );
      const historicalC3 = completeSum(
        group.rows.map(
          (row) => row.history?.[period === "2025" ? "c32025" : "c32026Ytd"],
        ),
      );
      const historicalInvestment = completeSum(
        group.rows.map((row) => historyInvestment(row.history, period)),
      );
      const contractVolume = completeSum(
        group.rows.map(
          (row) =>
            row.history?.[
              period === "2025" ? "contract2025" : "contract2026Ytd"
            ],
        ),
      );
      const phasing = aggregateHistoryPhasing(group.rows.map((row) => row.history), period);
      const aligned =
        period === "2025" ||
        group.rows.every((row) => !row.history?.ytdYieldUnavailableReason);
      return {
        ...group,
        metric,
        metricComplete,
        selectedCount: group.selected.size,
        allocatedCount: group.allocated.size,
        totalCount: Math.max(
          masterCounts.get(group.key) || 0,
          group.selected.size,
        ),
        amountShare: totalAmount ? (group.amount / totalAmount) * 100 : null,
        metricShare:
          group.rows.length && metricComplete && totalMetric
            ? (group.metric / totalMetric) * 100
            : null,
        gap:
          group.rows.length && metricComplete && totalAmount && totalMetric
            ? (group.amount / totalAmount) * 100 -
              (group.metric / totalMetric) * 100
            : null,
        historicalVol,
        historicalC3,
        historicalInvestment,
        contractVolume,
        analyticalVol,
        analyticalC3,
        phasing: phasing.ratio,
        phasingVolume: phasing.volume,
        phasingTarget: phasing.target,
        yieldAligned: aligned,
        historicalYield:
          aligned && historicalC3 > 0 && historicalInvestment > 0
            ? historicalC3 / historicalInvestment
            : null,
      };
    })
    .sort((left, right) => right.amount - left.amount);
}

export function versionFluctuation(current, previous, available = true) {
  if (!available || number(current) === null || number(previous) === null)
    return {
      changeRate: null,
      changeLabel: "不可比较",
      changeState: "missing",
    };
  if (previous === 0)
    return {
      changeRate: null,
      changeLabel: current > 0 ? "新增" : "无基期",
      changeState: current > 0 ? "new" : "zero",
    };
  const changeRate = ((current - previous) / previous) * 100;
  return {
    changeRate,
    changeLabel: `${changeRate > 0 ? "+" : ""}${changeRate.toFixed(1)}%`,
    changeState: "comparable",
  };
}

/** Both versions retain their own group attribution. Pass the intended Initiative
 * collection; sameInitiatives limits SD/RSM baselines to the current collection.
 */
export function compareVersionGroups(
  currentItems,
  sourceItems,
  dealers,
  groupBy = "initiative",
  options = {},
) {
  const current = (currentItems || []).filter((item) => item.enabled !== false);
  const keys = new Set(
    current.map((item) => String(item.initiativeKey || item.id)),
  );
  const previous = (sourceItems || []).filter(
    (item) =>
      item.enabled !== false &&
      (!options.sameInitiatives ||
        keys.has(String(item.initiativeKey || item.id))),
  );
  const groups = new Map();
  const ensure = (key, name, owner) => {
    if (!groups.has(key))
      groups.set(key, {
        key,
        name,
        owner,
        previousAmount: 0,
        currentAmount: 0,
        previousBudget: 0,
        currentBudget: 0,
        previousReserve: 0,
        currentReserve: 0,
        comparable: sourceItems !== null && sourceItems !== undefined,
      });
    return groups.get(key);
  };
  for (const [side, items] of [
    ["previous", previous],
    ["current", current],
  ]) {
    for (const item of items) {
      const identity = String(item.initiativeKey || item.id);
      const available =
        item.allocationVisible !== false &&
        (!options.requireConfirmed || item.workflow?.confirmed === true);
      const owner = item.ownerName || item.ownerId || "—";
      if (groupBy === "sd" || groupBy === "rsm") {
        for (const row of portfolioRows([item], dealers)) {
          const group = ensure(row[groupBy], row[groupBy], null);
          group[`${side}Amount`] += row.amount;
          group.comparable &&= available;
        }
        // A hidden allocation can belong to any SD: don't imply the visible
        // subset is a complete comparison when a scope member is unconfirmed.
        if (!available)
          for (const group of groups.values()) group.comparable = false;
      } else {
        const key =
          groupBy === "initiative" ? identity : item[groupBy] || "未配置";
        const group = ensure(
          key,
          groupBy === "initiative" ? item.name : key,
          groupBy === "initiative" ? owner : null,
        );
        // Display the current version owner when ownership changed; removed projects retain their source owner.
        if (groupBy === "initiative" && side === "current") group.owner = owner;
        group[`${side}Budget`] += number(item.budget) || 0;
        group[`${side}Amount`] += item.allocationTotal ?? (item.rows || []).reduce(
          (sum, row) => sum + (number(row.amount) || 0),
          0,
        );
        group[`${side}Reserve`] += item.reserveTotal ?? (item.otherBudgets || []).reduce(
          (sum, row) => sum + (number(row.amount) || 0),
          0,
        );
        group.comparable &&= available;
      }
    }
  }
  const hasUnknownGroup =
    ["sd", "rsm"].includes(groupBy) &&
    [...current, ...previous].some(
      (item) =>
        item.allocationVisible === false ||
        (options.requireConfirmed && item.workflow?.confirmed !== true),
    );
  return [...groups.values()]
    .map((group) => {
      const comparable = group.comparable && !hasUnknownGroup;
      return {
        ...group,
        comparable,
        previousAmount: comparable ? group.previousAmount : null,
        currentAmount: comparable ? group.currentAmount : null,
        previousReserve: comparable ? group.previousReserve : null,
        currentReserve: comparable ? group.currentReserve : null,
        delta: comparable ? group.currentAmount - group.previousAmount : null,
        budgetDelta: group.currentBudget - group.previousBudget,
        ...versionFluctuation(
          group.currentAmount,
          group.previousAmount,
          comparable,
        ),
      };
    })
    .sort(
      (left, right) =>
        (right.currentAmount || 0) - (left.currentAmount || 0) ||
        String(left.key).localeCompare(String(right.key)),
    );
}

export function initiativeOrganizationFacts(
  items,
  dealers,
  basis = "c3",
  period = "2025",
  threshold = 3,
  groupBy = "sd",
) {
  return (items || []).flatMap((item) =>
    groupSummary(
      portfolioRows([item], dealers, basis, period),
      dealers,
      groupBy,
      period,
    )
      .filter((group) => group.gap !== null && Math.abs(group.gap) > threshold)
      .map((group) => ({
        ...group,
        initiativeId: String(item.id),
        initiativeName: item.name,
        owner: item.ownerName || item.ownerId || "—",
        direction: group.gap > 0 ? "偏多" : "偏少",
      })),
  );
}

export const initiativeSdFacts = (
  items,
  dealers,
  basis = "c3",
  period = "2025",
  threshold = 3,
) =>
  initiativeOrganizationFacts(items, dealers, basis, period, threshold, "sd");

export function level(gap, yellow = 5, red = 10) {
  if (gap === null || !Number.isFinite(gap)) return "none";
  if (gap > red) return "bad";
  if (gap > yellow) return "warn";
  return "good";
}
