import type { ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { configuredYtdLabel, type HistoryPeriod } from "../domain/dealer-history";
import { MetricHelp } from "./MetricHelp";

/** Keep coverage next to every period selector, without widening its buttons. */
export function HistoryPeriodTabs({
  value,
  onValueChange,
  ytdCutoffMonth = 10,
  label = "历史期间",
  children,
}: {
  value: HistoryPeriod;
  onValueChange: (value: HistoryPeriod) => void;
  ytdCutoffMonth?: number | null;
  label?: string;
  children?: ReactNode;
}) {
  return <div className="history-period-tabs flex items-center gap-2">
    <Tabs value={value} onValueChange={(next) => onValueChange(next as HistoryPeriod)}>
      <TabsList aria-label={label}>
        <TabsTrigger value="2025">2025 全年</TabsTrigger>
        <TabsTrigger value="2026Ytd">2026 YTD</TabsTrigger>
      </TabsList>
    </Tabs>
    <MetricHelp>
      <p>2025 为全年；{configuredYtdLabel(ytdCutoffMonth)}，按年初至截止月累计，不自动年化。Actual 与历史费用的实际覆盖以各自数据源及本批确认信息为准；截止月未确认时，不视为完整同期数据。</p>
      {children}
    </MetricHelp>
  </div>;
}
