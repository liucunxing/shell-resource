import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";

export const PANEL_WIDTH_KEY = "shell-resource-work-panel-width";
export const DEFAULT_PANEL_WIDTH = 480;

export function panelBounds(viewport: number) {
  const phone = viewport < 760;
  const nav = viewport >= 1440 ? 272 : viewport >= 1200 ? 240 : 220;
  const max = Math.max(0, viewport < 1024
    ? viewport - (phone ? 0 : 24)
    : Math.min(900, viewport - nav - 480));
  return { min: Math.min(360, max), max, phone };
}

export function panelWidth(preferred: number | null, viewport: number) {
  const { min, max, phone } = panelBounds(viewport);
  if (phone) return max;
  return Math.min(max, Math.max(min, preferred ?? DEFAULT_PANEL_WIDTH));
}

function readWidth() {
  try {
    const value = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function useWorkPanelWidth() {
  const [preferred, setPreferred] = useState<number | null>(readWidth);
  const [viewport, setViewport] = useState(() => document.documentElement.clientWidth);
  const [resizing, setResizing] = useState(false);
  useEffect(() => {
    const resize = () => setViewport(document.documentElement.clientWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    try {
      if (preferred === null) localStorage.removeItem(PANEL_WIDTH_KEY);
      else localStorage.setItem(PANEL_WIDTH_KEY, String(preferred));
    } catch { /* Width adjustment remains usable when browser storage is unavailable. */ }
  }, [preferred]);
  return {
    width: panelWidth(preferred, viewport),
    ...panelBounds(viewport),
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
