import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import WorkbenchApp, { SkipToWorkspace } from "../src/workbench/WorkbenchApp.jsx";

const shared = vi.hoisted(() => ({ portalMode: true }));
vi.mock("../src/workbench/WorkbenchContext.jsx", () => ({
  useWorkbench: () => ({
    portalMode: shared.portalMode, apiMode: true, identity: { role: "owner", key: "A", email: "a@example.invalid" },
    state: {}, auxiliary: { open: false }, roles: [], page: "home", scenarioEpoch: 0,
  }),
}));
vi.mock("../src/workbench/WorkPanel.jsx", () => ({ WorkPanel: () => null }));
vi.mock("../src/workbench/WorkPanelResizer", () => ({ useWorkPanelWidth: () => ({ width: 480 }) }));
vi.mock("../src/workbench/ToastNotice.jsx", () => ({ ToastNotice: () => null }));

const hash = "#portal-instance=11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  shared.portalMode = true;
  vi.stubGlobal("window", { location: { hash }, matchMedia: () => ({ matches: false }) });
});
afterEach(() => vi.unstubAllGlobals());

describe("Portal navigation boundaries", () => {
  it("shows only the customer V17 owner navigation in both entry modes", () => {
    const portal = renderToStaticMarkup(<WorkbenchApp />);
    expect(portal).toContain("我的 Initiative");
    expect(portal).toContain("草稿与提交");
    expect(portal).not.toContain("小One问数Agent");
    expect(portal).not.toContain("原始数据");
    shared.portalMode = false;
    expect(renderToStaticMarkup(<WorkbenchApp />)).not.toContain("小One问数Agent");
  });

  it("focuses and scrolls the workspace without replacing the instance fragment", () => {
    const main = { focus: vi.fn(), scrollIntoView: vi.fn() };
    vi.stubGlobal("document", { getElementById: () => main });
    const link = SkipToWorkspace({ portalMode: true });
    expect(link.props.href).toBe(hash);
    const preventDefault = vi.fn();
    link.props.onClick({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(main.focus).toHaveBeenCalledOnce();
    expect(main.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    expect(window.location.hash).toBe(hash);
  });

  it("keeps the legacy skip-link target and behavior", () => {
    const main = { focus: vi.fn(), scrollIntoView: vi.fn() };
    vi.stubGlobal("document", { getElementById: () => main });
    const link = SkipToWorkspace({});
    expect(link.props.href).toBe("#main");
    link.props.onClick({ preventDefault: vi.fn() });
    expect(main.focus).toHaveBeenCalledOnce();
    expect(main.scrollIntoView).not.toHaveBeenCalled();
  });
});
