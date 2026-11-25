import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, tooltipContentClassName } from "@/components/ui/tooltip";
import { donutTooltipPosition } from "./donut-tooltip-position";
import { wholeMetric } from "../domain/metric-precision";

type Part = { label: string; value: number; color: string; onClick?: () => void };

function segmentPath(center: number, radius: number, strokeWidth: number, start: number, percent: number) {
  const point = (r: number, angle: number) => {
    const radians = (angle / 100 * 360 - 90) * Math.PI / 180;
    return `${center + r * Math.cos(radians)} ${center + r * Math.sin(radians)}`;
  };
  const outer = radius + strokeWidth / 2, inner = radius - strokeWidth / 2;
  const end = start + percent, largeArc = percent > 50 ? 1 : 0;
  return `M ${point(outer, start)} A ${outer} ${outer} 0 ${largeArc} 1 ${point(outer, end)} L ${point(inner, end)} A ${inner} ${inner} 0 ${largeArc} 0 ${point(inner, start)} Z`;
}

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
  const fullCircle = percent >= 100 - 1e-10;
  const Shape = fullCircle ? "circle" : "path";
  return <>
    <Tooltip open={focused && !point} onOpenChange={open => { if (!open) setFocused(false); }}>
      <TooltipTrigger asChild>
        <Shape {...(fullCircle ? { cx: center, cy: center, r: radius, fill: "none", stroke: part.color, strokeWidth } : { d: segmentPath(center, radius, strokeWidth, start, percent), fill: part.color })}
          tabIndex={0} aria-label={text}
          role={part.onClick ? "button" : "img"} style={{pointerEvents:fullCircle ? "stroke" : "visiblePainted", cursor:part.onClick ? "pointer" : "default"}}
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
        const text = `${part.label}：${wholeMetric(part.value)} 元 · ${percent.toLocaleString("zh-CN", {minimumFractionDigits: 1, maximumFractionDigits: 1})}%`;
        return <DonutSegment key={part.label} {...{ part, percent, start, text }} />;
      })}
    </svg>
    <div style={{ position: "relative", pointerEvents: "none" }}><strong style={{ fontSize: `${Math.max(10, Math.min(21, Math.floor(190 / Math.max(1, center.length))))}px` }}>{center}</strong><span>{caption}</span></div>
  </div></TooltipProvider>;
}

