import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { HistoryPeriod } from "../domain/dealer-history";

export function HistoryPeriodTabs({
  value,
  onValueChange,
  label = "历史期间",
}: {
  value: HistoryPeriod;
  onValueChange: (value: HistoryPeriod) => void;
  label?: string;
}) {
  return (
    <Tabs value={value} onValueChange={(next) => onValueChange(next as HistoryPeriod)}>
      <TabsList aria-label={label}>
        <TabsTrigger value="2025">2025 全年</TabsTrigger>
        <TabsTrigger value="2026Ytd">2026 YTD</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
