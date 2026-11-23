import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, tooltipContentClassName } from "@/components/ui/tooltip";
import { donutTooltipPosition } from "./donut-tooltip-position";

type Part = { label: string; value: number; color: string; onClick?: () => void };

export function DonutSegment({ part, percent, start, text, center = 75, radius = 64, strokeWidth = 22 }: { part: Part; percent: number; start: number; text: string; center?: number; radius?: number; strokeWidth?: number }) {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [focused, setFocused] = useState(false);
  const tipRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!point || !tipRef.current) return;
    const tip = tipRef.current;
    const { left, top } = donutTooltipPosition(point, { width: tip.offsetWidth, height: tip.offsetHeight }, { width: window.innerWidth, height: window.innerHeight });
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }, [point]);
  return <>
    <Tooltip open={focused && !point} onOpenChange={open => { if (!open) setFocused(false); }}>
      <TooltipTrigger asChild>
        <circle cx={center} cy={center} r={radius} fill="none" stroke={part.color} strokeWidth={strokeWidth}
          pathLength="100" strokeDasharray={`${percent} ${100 - percent}`} strokeDashoffset={-start}
          transform={`rotate(-90 ${center} ${center})`} tabIndex={0} aria-label={text}
          role={part.onClick ? "button" : "img"} style={{pointerEvents:"stroke", cursor:part.onClick ? "pointer" : "default"}}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          onPointerMove={event => { if (event.pointerType === "mouse") setPoint({ x: event.clientX, y: event.clientY }); }}
          onPointerLeave={() => setPoint(null)}
          onClick={part.onClick} onKeyDown={event => { if(part.onClick && ["Enter", " "].includes(event.key)) {event.preventDefault();part.onClick();} }} />
      </TooltipTrigger><TooltipContent>{text}</TooltipContent>
    </Tooltip>
    {point && createPortal(<div ref={tipRef} aria-hidden="true" className={tooltipContentClassName}
      style={{ position: "fixed", left: -9999, top: -9999, pointerEvents: "none", zIndex: 300 }}>{text}</div>, document.body)}
  </>;
}

export function BudgetDonut({ parts, center, caption }: { parts: Part[]; center: string; caption: string }) {
  const total = parts.reduce((sum, part) => sum + Math.max(0, part.value), 0);
  let offset = 0;
  return <TooltipProvider><div className="v19-budget-donut" style={{ position: "relative" }}>
    <svg viewBox="0 0 150 150" width="150" height="150" style={{ position: "absolute", inset: 0 }} aria-label={caption === "个资源大类" ? "各资源大类预算占比" : caption}>
      <circle cx="75" cy="75" r="64" fill="none" stroke="#D9D9D9" strokeWidth="22" />
      {parts.filter(part => part.value > 0).map(part => {
        const percent = part.value / total * 100, start = offset; offset += percent;
        const text = `${part.label}：${(part.value / 10000).toLocaleString("zh-CN", {minimumFractionDigits: 1, maximumFractionDigits: 1})} 万元 · ${percent.toFixed(1)}%`;
        return <DonutSegment key={part.label} {...{ part, percent, start, text }} />;
      })}
    </svg>
    <div style={{ position: "relative", pointerEvents: "none" }}><strong>{center}</strong><span>{caption}</span></div>
  </div></TooltipProvider>;
}

