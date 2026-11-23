export type HistoryPeriod = "2025" | "2026Ytd";
export type HistoryBasis = "vol" | "c3" | "investment";
export type HistoryField =
  | "vol2025"
  | "c32025"
  | "vol2026Ytd"
  | "c32026Ytd"
  | "investment2025"
  | "investment2026Ytd";
type ResourceValues = Record<string, number | null | undefined>;
export interface DealerHistory {
  totalInvestment2025?: number | null;
  totalInvestment2026Ytd?: number | null;
  ytdYieldUnavailableReason?: string;
  vol2025?: number | null;
  c32025?: number | null;
  vol2026Ytd?: number | null;
  c32026Ytd?: number | null;
  yield?: number | null;
  yield2026Ytd?: number | null;
  sourceTarget2025?: number | null;
  sourceTarget2026Ytd?: number | null;
  contract2025?: number | null;
  contract2026Ytd?: number | null;
  vol2024?: number | null;
  c32024?: number | null;
  resources2025?: ResourceValues;
  resources2026Ytd?: ResourceValues;
  restrictedResources2025?: string[];
  restrictedResources2026Ytd?: string[];
}
export interface HistoryDealer {
  id: string;
  code?: string;
  name?: string | null;
  sector?: string | null;
  sd?: string | null;
  rsm?: string | null;
  status?: string | number | null;
  history?: DealerHistory;
}
export const HISTORY_RESOURCES = ["MRD", "ICE Rebate", "SP&A", "Capex"];

export function isActiveDealer(dealer: HistoryDealer): boolean {
  const status = String(dealer.status ?? "").trim().toLowerCase();
  return status === "active" || status === "1";
}

export function finiteHistoryValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Source values remain L / USD (C3) / USD (normalized investment); display scaling is 1,000.
export function historyDisplayValue(value: unknown): number | null {
  const raw = finiteHistoryValue(value);
  return raw === null ? null : raw / 1000;
}

export function historyInvestment(
  history: DealerHistory | undefined,
  period: HistoryPeriod,
): number | null {
  const publicKey =
    period === "2025" ? "totalInvestment2025" : "totalInvestment2026Ytd";
  // A public total is computed before expense-column authorization. Never replace
  // an explicit null with the sum of a partial or authorized subset.
  if (history && Object.hasOwn(history, publicKey))
    return finiteHistoryValue(history[publicKey]);
  const values =
    period === "2025" ? history?.resources2025 : history?.resources2026Ytd;
  const restricted =
    period === "2025"
      ? history?.restrictedResources2025
      : history?.restrictedResources2026Ytd;
  if (restricted?.length || !values) return null;
  const amounts = HISTORY_RESOURCES.map((key) =>
    finiteHistoryValue(values[key]),
  );
  return amounts.some((value) => value === null)
    ? null
    : amounts.reduce<number>((sum, value) => sum + value!, 0);
}

/** Denominators use known values across the complete selection, not the current page.
 * A missing dealer cell stays missing; it does not erase other dealers' shares.
 */
export function historyShareDenominators(
  histories: (DealerHistory | undefined)[],
  period: HistoryPeriod,
) {
  const total = (values: unknown[]): number | null => {
    const known = values.map(finiteHistoryValue).filter((value): value is number => value !== null);
    return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
  };
  return {
    vol: total(histories.map((history) => history?.[`vol${period}`])),
    c3: total(histories.map((history) => history?.[`c3${period}`])),
    contract: total(histories.map((history) => history?.[`contract${period}`])),
    investment: total(histories.map((history) => historyInvestment(history, period))),
  };
}

export function historyShare(value: unknown, denominator: number | null): number | null {
  const numeric = finiteHistoryValue(value);
  return numeric !== null && denominator !== null && denominator > 0
    ? numeric / denominator * 100 : null;
}

export function historyYield(
  history: DealerHistory | undefined,
  period: HistoryPeriod,
): number | null {
  if (period !== "2025" && history?.ytdYieldUnavailableReason) return null;
  const c3 = finiteHistoryValue(
    period === "2025" ? history?.c32025 : history?.c32026Ytd,
  );
  const investment = historyInvestment(history, period);
  return c3 !== null && c3 > 0 && investment !== null && investment > 0
    ? c3 / investment
    : null;
}

export function historyYoyLabel(
  history: DealerHistory | undefined,
  basis: "vol" | "c3",
): string {
  const prior = finiteHistoryValue(
    basis === "vol" ? history?.vol2024 : history?.c32024,
  );
  const current = finiteHistoryValue(
    basis === "vol" ? history?.vol2025 : history?.c32025,
  );
  if (prior !== null && prior <= 0) return "无基期";
  if (prior === null || current === null) return "—";
  return `${(((current - prior) / prior) * 100).toLocaleString("zh-CN", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

export function configuredYtdLabel(month: number | null = 10): string {
  if (month === null) return "2026 YTD（截止月待确认）";
  const safeMonth =
    Number.isInteger(month) && month >= 1 && month <= 12 ? month : 10;
  return `2026 YTD（1–${safeMonth}月）`;
}

export function allocationHistoryField(
  basis: HistoryBasis,
  period: HistoryPeriod,
): HistoryField {
  return `${basis === "vol" ? "vol" : basis === "c3" ? "c3" : "investment"}${period}` as HistoryField;
}

// Directory metadata must not mask the matching sector's historical metrics.
export function initiativeDealers(
  history: HistoryDealer[],
  directory: HistoryDealer[],
  sector: string,
): HistoryDealer[] {
  const scoped = (rows: HistoryDealer[]) =>
    rows.filter((row) => row.sector === sector || !row.sector);
  const records = new Map<string, HistoryDealer>();
  for (const row of [...scoped(directory), ...scoped(history)]) {
    const id = String(row.id);
    records.set(id, { ...records.get(id), ...row, id });
  }
  return [...records.values()];
}
