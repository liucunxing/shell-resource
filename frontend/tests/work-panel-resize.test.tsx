import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { panelBounds, panelWidth, WorkPanelResizer } from "../src/workbench/WorkPanelResizer";

describe("responsive work panel width", () => {
  it("defaults to 480px on regular desktops and leaves at least 480px for the workspace", () => {
    expect(panelWidth(null, 1280)).toBe(480);
    expect(panelWidth(null, 1440)).toBe(480);
    for (const viewport of [1024, 1100, 1199, 1200, 1280, 1440, 1920]) {
      const nav = viewport >= 1440 ? 272 : viewport >= 1200 ? 240 : 220;
      expect(viewport - nav - panelWidth(900, viewport)).toBeGreaterThanOrEqual(480);
    }
  });
  it("clamps a saved width temporarily without losing the large-screen preference", () => {
    expect(panelWidth(680, 1440)).toBe(680);
    expect(panelWidth(680, 1024)).toBe(324);
    expect(panelWidth(680, 1440)).toBe(680);
    expect(panelWidth(50, 1280)).toBe(360);
    expect(panelWidth(2000, 1920)).toBe(900);
  });
  it("uses a bounded overlay on tablets and fills the phone viewport", () => {
    expect(panelWidth(null, 1023)).toBe(480);
    expect(panelWidth(900, 800)).toBe(776);
    for (const viewport of [320, 375, 390, 759]) {
      expect(panelWidth(680, viewport)).toBe(viewport);
      expect(panelBounds(viewport).phone).toBe(true);
    }
  });
  it("exposes a focusable vertical separator and its current limits", () => {
    const html = renderToStaticMarkup(<WorkPanelResizer width={480} min={360} max={688}
      onChange={vi.fn()} onResizingChange={vi.fn()} />);
    expect(html).toContain('role="separator"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-valuenow="480"');
    expect(html).toContain('aria-valuemax="688"');
    expect(html).toContain('aria-controls="work-panel"');
  });
});
