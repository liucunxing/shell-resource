import { portfolioRows } from "./portfolio-analytics.js";
import { historyPhasing, historyInvestment, historyYield } from "./dealer-history";

const ratio = (value, total) =>
  value != null && total > 0 ? (value / total) * 100 : null;
const availableTotal = (values) => {
  const valid = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) : null;
};
export function dealerDetailRows(items, dealers, basis, period) {
  const rows = portfolioRows(items, dealers, basis, period),
    suffix = period === "2025" ? "2025" : "2026Ytd";
  const amount = rows.reduce((sum, row) => sum + row.amount, 0),
    vol = availableTotal(rows.map((row) => row.history[`vol${suffix}`])),
    c3 = availableTotal(rows.map((row) => row.history[`c3${suffix}`]));
  const investment = availableTotal(
      rows.map((row) => historyInvestment(row.history, period)),
    ),
    contract = availableTotal(rows.map((row) => row.history[`contract${suffix}`]));
  return rows.map((row) => {
    const h = row.history,
      amountShare = ratio(row.amount, amount),
      volShare = ratio(h[`vol${suffix}`], vol),
      c3Share = ratio(h[`c3${suffix}`], c3);
    return {
      ...row,
      investment: historyInvestment(h, period),
      yield: historyYield(h, period),
      investmentShare: ratio(historyInvestment(h, period), investment),
      contract: h[`contract${suffix}`] ?? null,
      contractShare: ratio(h[`contract${suffix}`], contract),
      vol: h[`vol${suffix}`] ?? null,
      c3: h[`c3${suffix}`] ?? null,
      phasing: historyPhasing(h, period) == null ? null : historyPhasing(h, period) * 100,
      amountShare,
      volShare,
      c3Share,
      gapVol:
        amountShare != null && volShare != null ? amountShare - volShare : null,
      gapC3:
        amountShare != null && c3Share != null ? amountShare - c3Share : null,
      resources: h[`resources${suffix}`] || {},
    };
  });
}
