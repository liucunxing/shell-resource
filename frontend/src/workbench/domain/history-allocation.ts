type AllocationRow = { dealerId: string; amount: number; note?: string };
type Dealer = {
  id: string;
  name?: string;
  history?: { vol2025?: number | null; c32025?: number | null };
};

export function allocateByHistory(
  rows: AllocationRow[],
  dealers: Dealer[],
  availableCents: number,
  field: "vol2025" | "c32025",
) {
  if (!Number.isSafeInteger(availableCents) || availableCents < 0)
    throw Error("其他预算安排超过总预算或可分配预算无效，无法辅助填充。");
  const byId = new Map(dealers.map((dealer) => [String(dealer.id), dealer]));
  const weighted = rows.map((row) => {
    const dealer = byId.get(String(row.dealerId));
    const value = dealer?.history?.[field];
    return {
      name: `${dealer?.name || row.dealerId}（${row.dealerId}）`,
      weight: typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0,
    };
  });
  const sum = weighted.reduce((total, dealer) => total + dealer.weight, 0);
  const exact = weighted.map((dealer) => sum ? availableCents * (dealer.weight / sum) : 0);
  const cents = exact.map(Math.floor);
  const left = sum ? availableCents - cents.reduce((total, value) => total + value, 0) : 0;
  const order = exact.map((value, index) => ({ index, fraction: value - cents[index] }))
    .filter(({ index }) => weighted[index].weight > 0)
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let n = 0; n < left; n++) cents[order[n % order.length].index]++;
  return {
    rows: rows.map((row, index) => ({ ...row, amount: cents[index] / 100 })),
    unavailable: weighted.filter((dealer) => dealer.weight === 0).map((dealer) => dealer.name),
    hasHistory: sum > 0,
  };
}
