import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";

// Reset the former oversized preference once, then remember each user's new choice.
export const PANEL_WIDTH_KEY = "shell-resource-work-panel-width-v2";
export const DEFAULT_PANEL_WIDTH = 420;

export function panelBounds(viewport: number, navCollapsed = false, layoutViewport = viewport) {
  const available = Number.isFinite(viewport) ? Math.max(0, Math.floor(viewport)) : 0;
  // Media queries include the scrollbar; usable grid width does not.
  const layout = Number.isFinite(layoutViewport) ? Math.max(0, layoutViewport) : available;
  const phone = layout < 760;
  const navigation = navCollapsed ? 0 : layout >= 1440 ? 272 : 240;
  const max = layout < 1200
    ? Math.max(0, available - (phone ? 0 : 24))
    : Math.min(Math.floor(available * 2 / 3), Math.max(0, available - navigation - 560));
  return { min: Math.min(360, max), max, phone };
}

export function panelWidth(
  preferred: number | null, viewport: number, navCollapsed = false, layoutViewport = viewport,
) {
  const { min, max, phone } = panelBounds(viewport, navCollapsed, layoutViewport);
  if (phone) return max;
  const width = preferred !== null && Number.isFinite(preferred) && preferred > 0
    ? preferred : DEFAULT_PANEL_WIDTH;
  return Math.min(max, Math.max(min, width));
}

function readWidth() {
  try {
    const value = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

const layoutBreakpoints = [1440, 1200, 760];
const breakpointQuery = (width: number) => `(min-width: ${width}px)`;
function readViewport() {
  return {
    available: document.documentElement.clientWidth,
    // Rounded innerWidth can cross a CSS breakpoint when browser zoom creates fractions.
    layout: layoutBreakpoints.find((width) => window.matchMedia(breakpointQuery(width)).matches) ?? 0,
  };
}

export function useWorkPanelWidth(navCollapsed = false) {
  const [preferred, setPreferred] = useState<number | null>(readWidth);
  const [viewport, setViewport] = useState(readViewport);
  const [resizing, setResizing] = useState(false);
  useEffect(() => {
    const resize = () => {
      const next = readViewport();
      setViewport((current) => current.available === next.available && current.layout === next.layout
        ? current : next);
    };
    window.addEventListener("resize", resize);
    const media = layoutBreakpoints.map((width) => window.matchMedia(breakpointQuery(width)));
    media.forEach((query) => query.addEventListener("change", resize));
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(document.documentElement);
    resize();
    return () => {
      window.removeEventListener("resize", resize);
      media.forEach((query) => query.removeEventListener("change", resize));
      observer?.disconnect();
    };
  }, []);
  useEffect(() => {
    try {
      if (preferred === null) localStorage.removeItem(PANEL_WIDTH_KEY);
      else localStorage.setItem(PANEL_WIDTH_KEY, String(preferred));
    } catch { /* Width adjustment remains usable when browser storage is unavailable. */ }
  }, [preferred]);
  return {
    width: panelWidth(preferred, viewport.available, navCollapsed, viewport.layout),
    ...panelBounds(viewport.available, navCollapsed, viewport.layout),
    onChange: setPreferred,
    onResizingChange: setResizing,
    resizing,
  };
}

type Props = {
  width: number;
  min: number;
  max: number;
  onChange: (width: number | null) => void;
  onResizingChange: (resizing: boolean) => void;
};

export function WorkPanelResizer({ width, min, max, onChange, onResizingChange }: Props) {
  const drag = useRef<{ id: number; x: number; width: number } | null>(null);
  const clamp = (value: number) => Math.round(Math.min(max, Math.max(min, value)));
  const finish = () => {
    drag.current = null;
    onResizingChange(false);
  };
  useEffect(() => {
    window.addEventListener("blur", finish);
    return () => {
      window.removeEventListener("blur", finish);
      onResizingChange(false);
    };
  }, [onResizingChange]);
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || event.pointerId !== drag.current.id) return;
    onChange(clamp(drag.current.width + drag.current.x - event.clientX));
  };
  return (
    <div
      className="work-resize-handle"
      role="separator"
      tabIndex={0}
      aria-label="调整右侧工作栏宽度"
      aria-orientation="vertical"
      aria-controls="work-panel"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(width)}
      aria-valuetext={`${Math.round(width)} 像素`}
      title="拖动调整宽度；双击恢复默认；方向键微调"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { id: event.pointerId, x: event.clientX, width };
        onResizingChange(true);
      }}
      onPointerMove={move}
      onPointerUp={(event) => { move(event); finish(); }}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onDoubleClick={() => onChange(null)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 50 : 20;
        const values: Record<string, number | null> = {
          ArrowLeft: clamp(width + step), ArrowRight: clamp(width - step),
          Home: min, End: max, Enter: null,
        };
        if (event.key in values) {
          event.preventDefault();
          onChange(values[event.key]);
        }
      }}
    />
  );
}
