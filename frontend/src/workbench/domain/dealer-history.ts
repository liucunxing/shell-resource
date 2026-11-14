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
  vol2025?: number | null;
  c32025?: number | null;
  vol2026Ytd?: number | null;
  c32026Ytd?: number | null;
  yield?: number | null;
  yield2026Ytd?: number | null;
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
  return dealer.status === "active" || String(dealer.status) === "1";
}

export function finiteHistoryValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Source values remain L / $ in the API and allocation calculations.
export function historyDisplayValue(value: unknown): number | null {
  const raw = finiteHistoryValue(value);
  return raw === null ? null : raw / 1000;
}

export function historyInvestment(
  history: DealerHistory | undefined,
  period: HistoryPeriod,
): number | null {
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

export function historyYield(
  history: DealerHistory | undefined,
  period: HistoryPeriod,
): number | null {
  return finiteHistoryValue(
    period === "2025" ? history?.yield : history?.yield2026Ytd,
  );
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
