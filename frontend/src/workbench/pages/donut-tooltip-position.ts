export function donutTooltipPosition(
  point: { x: number; y: number },
  tip: { width: number; height: number },
  viewport: { width: number; height: number },
) {
  const margin = 8;
  return {
    left: Math.max(margin, Math.min(point.x + 12, viewport.width - tip.width - margin)),
    top: Math.max(margin, Math.min(point.y + 12, viewport.height - tip.height - margin)),
  };
}
