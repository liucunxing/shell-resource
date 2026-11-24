/** RSM is a distinct organization only for PCMO. */
export const hasRsm = (sector: unknown): boolean =>
  String(sector ?? "").trim().toUpperCase() === "PCMO";

export const scopeHasRsm = (items: { sector?: unknown }[]): boolean =>
  items.some((item) => hasRsm(item.sector));
