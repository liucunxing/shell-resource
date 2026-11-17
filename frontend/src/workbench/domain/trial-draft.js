import { reserveAcknowledgementFingerprint } from "./reserve-review.js";

const normalizeRows = rows => rows.map(row => ({
  dealerId: String(row.dealerId),
  amount: Number(row.amount),
  note: row.note || "",
}));

// Ignore server-assigned row IDs and ordering, while invalidating a selection
// whenever its allocations, reserve, budget, owner or version no longer match.
export function trialAllocationFingerprint(initiative) {
  return JSON.stringify({
    context: reserveAcknowledgementFingerprint({ ...initiative, budget: Number(initiative.budget) }),
    sector: initiative.sector,
    rows: normalizeRows(initiative.rows || []).sort((a, b) => a.dealerId.localeCompare(b.dealerId)),
  });
}

export function restoredTrial(initiative) {
  const trial = initiative?.editorState?.trial;
  if (!trial || !["vol", "c3", "investment"].includes(trial.metric) ||
      !["2025", "2026Ytd"].includes(trial.period) || !Array.isArray(trial.baselineRows) ||
      trial.allocationFingerprint !== trialAllocationFingerprint(initiative)) return null;
  const baselineRows = normalizeRows(trial.baselineRows);
  const ids = new Set((initiative.rows || []).map(row => String(row.dealerId)));
  if (baselineRows.length !== ids.size || new Set(baselineRows.map(row => row.dealerId)).size !== ids.size ||
      baselineRows.some(row => !ids.has(row.dealerId) || !Number.isFinite(row.amount) || row.amount < 0)) return null;
  return { ...trial, baselineRows };
}

export function trialDraftState(initiative, rows, metric, period, baselineRows) {
  return {
    metric, period, baselineRows: normalizeRows(baselineRows),
    allocationFingerprint: trialAllocationFingerprint({ ...initiative, rows }),
  };
}
