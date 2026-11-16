import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "../../components/ui/tooltip";
import type { ReactNode } from "react";

export function MetricHelp({ children, label = "口径说明" }: { children: ReactNode; label?: string }) {
  return <TooltipProvider><Tooltip><TooltipTrigger asChild><span tabIndex={0} aria-label={label} className="metric-help-icon">!</span></TooltipTrigger><TooltipContent sideOffset={6} className="metric-help-content">{children}</TooltipContent></Tooltip></TooltipProvider>;
}
