import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  panelBounds, panelWidth, PANEL_WIDTH_KEY, useWorkPanelWidth, WorkPanelResizer,
} from "../src/workbench/WorkPanelResizer";

afterEach(() => vi.unstubAllGlobals());

function stubViewport(available: number, cssWidth = available, innerWidth = Math.round(cssWidth)) {
  vi.stubGlobal("document", { documentElement: { clientWidth: available } });
  vi.stubGlobal("window", {
    innerWidth,
    matchMedia: (query: string) => ({
      matches: cssWidth >= Number(query.match(/min-width: (\d+)px/)?.[1]),
    }),
  });
}

describe("responsive work panel width", () => {
  it("opens compactly and leaves at least 560px for the desktop workspace", () => {
    expect(panelWidth(null, 1280)).toBe(420);
    expect(panelWidth(null, 1440)).toBe(420);
    expect(panelWidth(null, 1200)).toBe(400);
    expect(panelBounds(1280).max).toBe(480);
    expect(panelBounds(1440).max).toBe(608);
    expect(panelBounds(1920).max).toBe(1088);
    expect(1440 - 272 - panelWidth(10000, 1440)).toBe(560);
  });
  it("makes the hidden navigation's space available while retaining a usable workspace", () => {
    expect(panelWidth(10000, 1440, true)).toBe(880);
    expect(panelWidth(10000, 1920, true)).toBe(1280);
    expect(panelWidth(800, 1440, true)).toBe(800);
    expect(panelWidth(800, 1440, false)).toBe(608);
  });
  it.each([
    { layout: 1200, available: 1183, navigation: 240, maximum: 383 },
    { layout: 1440, available: 1423, navigation: 272, maximum: 591 },
  ])("keeps the CSS desktop layout safe with a scrollbar at $layout px", ({
    layout, available, navigation, maximum,
  }) => {
    const width = panelWidth(10000, available, false, layout);
    expect(width).toBe(maximum);
    expect(available - navigation - width).toBe(560);
    expect(panelWidth(10000, available, true, layout)).toBe(maximum + navigation);
  });
  it("clamps a saved width temporarily without losing the large-screen preference", () => {
    const preferred = 900;
    expect(panelWidth(preferred, 1920)).toBe(900);
    expect(panelWidth(preferred, 1280)).toBe(480);
    expect(panelWidth(preferred, 1920)).toBe(900);
    expect(panelWidth(50, 1280)).toBe(360);
  });
  it("uses a bounded overlay on tablets and fills the phone viewport", () => {
    expect(panelWidth(null, 1199)).toBe(420);
    expect(panelWidth(1200, 1199)).toBe(1175);
    expect(panelWidth(900, 800)).toBe(776);
    expect(panelWidth(900, 760)).toBe(736);
    for (const viewport of [320, 375, 390, 759]) {
      expect(panelWidth(680, viewport)).toBe(viewport);
      expect(panelBounds(viewport).phone).toBe(true);
    }
    expect(panelBounds(743, false, 760).phone).toBe(false);
    expect(panelWidth(900, 743, false, 760)).toBe(719);
    expect(panelBounds(742, false, 759).phone).toBe(true);
    expect(panelWidth(900, 742, false, 759)).toBe(742);
  });
  it("ignores corrupt preferences and never returns invalid CSS dimensions", () => {
    for (const preferred of [null, NaN, Infinity, -Infinity, -20, 0]) {
      expect(panelWidth(preferred, 1440)).toBe(420);
    }
    for (const viewport of [NaN, Infinity, -Infinity, -20, 0]) {
      expect(panelWidth(900, viewport)).toBe(0);
    }
  });
  it("resets the old wide preference once and reads new user choices", () => {
    const stored = new Map([["shell-resource-work-panel-width", "1060"]]);
    const getItem = vi.fn((key: string) => stored.get(key) ?? null);
    vi.stubGlobal("localStorage", { getItem });
    stubViewport(1440);
    function Width() {
      const size = useWorkPanelWidth();
      return <output>{size.width}</output>;
    }
    expect(renderToStaticMarkup(<Width />)).toContain(">420</output>");
    expect(getItem).not.toHaveBeenCalledWith("shell-resource-work-panel-width");
    stored.set(PANEL_WIDTH_KEY, "580");
    expect(renderToStaticMarkup(<Width />)).toContain(">580</output>");
  });
  it("still uses a compact default when browser storage is unavailable", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("Blocked"); } });
    stubViewport(1440);
    function Width() {
      return <output>{useWorkPanelWidth().width}</output>;
    }
    expect(renderToStaticMarkup(<Width />)).toContain(">420</output>");
  });
  it("reads layout and available widths separately when restoring a saved preference", () => {
    vi.stubGlobal("localStorage", { getItem: () => "900" });
    stubViewport(1183, 1200);
    function Width() {
      return <output>{useWorkPanelWidth().width}</output>;
    }
    expect(renderToStaticMarkup(<Width />)).toContain(">383</output>");
  });
  it.each([
    { cssWidth: 1199.333, innerWidth: 1199, available: 1182, expected: 900 },
    { cssWidth: 1199.667, innerWidth: 1200, available: 1183, expected: 900 },
    { cssWidth: 1200.333, innerWidth: 1200, available: 1183, expected: 383 },
    { cssWidth: 1439.333, innerWidth: 1439, available: 1422, expected: 622 },
    { cssWidth: 1439.667, innerWidth: 1440, available: 1423, expected: 623 },
    { cssWidth: 1440.333, innerWidth: 1440, available: 1423, expected: 591 },
  ])("uses CSS media-query results at a fractional $cssWidth px viewport", ({
    cssWidth, innerWidth, available, expected,
  }) => {
    vi.stubGlobal("localStorage", { getItem: () => "900" });
    stubViewport(available, cssWidth, innerWidth);
    function Width() {
      return <output>{useWorkPanelWidth().width}</output>;
    }
    expect(renderToStaticMarkup(<Width />)).toContain(`>${expected}</output>`);
  });
  it("exposes a focusable vertical separator and its current limits", () => {
    const html = renderToStaticMarkup(<WorkPanelResizer width={420} min={360} max={608}
      onChange={vi.fn()} onResizingChange={vi.fn()} />);
    expect(html).toContain('role="separator"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-valuenow="420"');
    expect(html).toContain('aria-valuemax="608"');
    expect(html).toContain('aria-controls="work-panel"');
  });
});
