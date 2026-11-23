import { wholeMetric } from "../domain/metric-precision";

export function PlanningSummaryAmount({ value }: { value: number }) {
  return <span>{wholeMetric(value)}</span>;
}
