const wholeNumber = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });

export function wholeMetric(value: unknown, scale = 1): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const scaled = value / scale;
  return wholeNumber.format(Math.abs(scaled) < 0.5 ? 0 : scaled);
}

export function isHistoricalOutput(key: string): boolean {
  return /^(vol|c3)20\d{2}(Ytd)?$/.test(key);
}
