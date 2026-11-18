import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";

const wanFormatter = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const yuanFormatter = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function PlanningSummaryAmount({ value }: { value: number }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="cursor-help">
          {wanFormatter.format(value / 10000)}
        </span>
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>{yuanFormatter.format(value)} 元</TooltipContent>
    </Tooltip>
  );
}
