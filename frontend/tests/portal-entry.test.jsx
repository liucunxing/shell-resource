import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => {
  vi.stubEnv("VITE_DATA_MODE", "demo");
  return { effects: [], legacy: vi.fn(), read: vi.fn(), workspace: vi.fn() };
});
vi.mock("react", async (original) => ({
  ...(await original()), useEffect: (effect) => mocks.effects.push(effect),
}));
vi.mock("../src/portal/session", () => ({ isPortalEntry: () => true, logoutPortalSession: vi.fn() }));
vi.mock("../src/workbench/api.js", () => ({
  acceptPortalEmail: mocks.legacy, getDevelopmentEmail: mocks.read, workspace: mocks.workspace,
}));

import { WorkbenchProvider, useWorkbench } from "../src/workbench/WorkbenchContext.jsx";
function State() {
  const { apiMode, portalMode, identity, devEmail } = useWorkbench();
  return <span>{JSON.stringify({ apiMode, portalMode, identity, devEmail })}</span>;
}

beforeEach(() => {
  mocks.effects.length = 0;
  mocks.workspace.mockReset().mockResolvedValue({ identity: { email: "portal-b@example.invalid", role: "admin" } });
});
afterAll(() => vi.unstubAllEnvs());

describe("Portal workbench startup", () => {
  it("skips the old handoff before module startup and does not read the old email", () => {
    const html = renderToStaticMarkup(<WorkbenchProvider><State /></WorkbenchProvider>);
    expect(mocks.legacy).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(html).toContain('&quot;apiMode&quot;:true');
    expect(html).toContain('&quot;portalMode&quot;:true');
    expect(html).toContain('&quot;identity&quot;:null');
  });

  it("loads the new session-backed workspace without an email handoff", async () => {
    renderToStaticMarkup(<WorkbenchProvider><State /></WorkbenchProvider>);
    mocks.effects[0]();
    await vi.waitFor(() => expect(mocks.workspace).toHaveBeenCalledOnce());
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
