import { useId, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import "../analysis-conclusion.css";

/** Shared analysis treatment, including drawers rendered outside the page shell. */
export function AnalysisConclusion({
  title = "分析结论",
  children,
  className,
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const titleId = useId();
  return (
    <Card
      className={cn("analysis-conclusion", className)}
      role="region"
      aria-labelledby={titleId}
    >
      <h3 id={titleId}>{title}</h3>
      <div className="analysis-conclusion-content">{children}</div>
    </Card>
  );
}

export function AnalysisValue({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "investment" | "output" | "alert" | "neutral";
}) {
  return (
    <strong className="analysis-value" data-tone={tone}>
      {children}
    </strong>
  );
}
