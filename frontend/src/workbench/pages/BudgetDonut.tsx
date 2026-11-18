import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";

type Part = { label: string; value: number; color: string; onClick?: () => void };
export function BudgetDonut({ parts, center, caption }: { parts: Part[]; center: string; caption: string }) {
  const total = parts.reduce((sum, part) => sum + Math.max(0, part.value), 0);
  let offset = 0;
  return <TooltipProvider><div className="v19-budget-donut" style={{ position: "relative" }}>
    <svg viewBox="0 0 150 150" width="150" height="150" style={{ position: "absolute", inset: 0 }} aria-label={caption === "个资源大类" ? "各资源大类预算占比" : caption}>
      <circle cx="75" cy="75" r="64" fill="none" stroke="#D9D9D9" strokeWidth="22" />
      {parts.filter(part => part.value > 0).map(part => {
        const percent = part.value / total * 100, start = offset; offset += percent;
        const text = `${part.label}：${(part.value / 10000).toLocaleString("zh-CN", {minimumFractionDigits: 1, maximumFractionDigits: 1})} 万元 · ${percent.toFixed(1)}%`;
        return <Tooltip key={part.label}><TooltipTrigger asChild>
          <circle cx="75" cy="75" r="64" fill="none" stroke={part.color} strokeWidth="22"
            pathLength="100" strokeDasharray={`${percent} ${100 - percent}`} strokeDashoffset={-start}
            transform="rotate(-90 75 75)" tabIndex={0} aria-label={text}
            role={part.onClick ? "button" : "img"} style={{pointerEvents:"stroke", cursor:part.onClick ? "pointer" : "default"}}
            onClick={part.onClick} onKeyDown={event => { if(part.onClick && ["Enter", " "].includes(event.key)) {event.preventDefault();part.onClick();} }} />
        </TooltipTrigger><TooltipContent>{text}</TooltipContent></Tooltip>;
      })}
    </svg>
    <div style={{ position: "relative", pointerEvents: "none" }}><strong>{center}</strong><span>{caption}</span></div>
  </div></TooltipProvider>;
}

