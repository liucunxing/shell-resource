import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CumulativeChart } from "../src/workbench/pages/V19PortfolioVisuals.jsx";

function labels(count) {
  const rows = Array.from({ length: count }, (_, index) => ({
    id: String(index), amount: count - index, metric: count - index,
  }));
  const html = renderToStaticMarkup(<CumulativeChart rows={rows} top={20} basis="c3" onSelect={vi.fn()} />);
  return [...html.matchAll(/<text class="v19-top-label" x="([^"]+)" y="([^"]+)" text-anchor="middle">Top (\d+)%<\/text>/g)]
    .map(([, x, y, top]) => ({ top: Number(top), x: Number(x), y: Number(y) }));
}

describe("concentration chart labels", () => {
  it("stacks all three labels when one dealer is selected for every threshold", () => {
    const result = labels(1);
    expect(result.map((item) => item.top)).toEqual([20, 50, 80]);
    expect(new Set(result.map((item) => item.x)).size).toBe(1);
    expect(new Set(result.map((item) => item.y)).size).toBe(3);
  });
  it("only stacks labels sharing the same dealer count", () => {
    const result = labels(2);
    expect(result[0].x).toBe(result[1].x);
    expect(result[0].y).not.toBe(result[1].y);
    expect(result[2].x).not.toBe(result[0].x);
    expect(result[2].y).toBe(result[0].y);
  });
  it("keeps nonoverlapping labels aligned", () => {
    const result = labels(10);
    expect(new Set(result.map((item) => item.x)).size).toBe(3);
    expect(new Set(result.map((item) => item.y)).size).toBe(1);
  });
});
