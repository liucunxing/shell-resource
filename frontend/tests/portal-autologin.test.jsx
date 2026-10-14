import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { effects, getDevelopmentEmail, workspace } = vi.hoisted(() => ({
  effects: [],
  getDevelopmentEmail: vi.fn(),
  workspace: vi.fn(),
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal()),
  useEffect: (effect) => effects.push(effect),
}));
vi.mock("../src/workbench/api.js", () => ({
  acceptPortalEmail: vi.fn(),
  getDevelopmentEmail,
  workspace,
}));

import { WorkbenchProvider } from "../src/workbench/WorkbenchContext.jsx";

beforeEach(() => {
  effects.length = 0;
  vi.clearAllMocks();
  workspace.mockResolvedValue({ identity: { email: "portal@example.com", role: "admin" } });
});
afterEach(() => vi.restoreAllMocks());

describe("Portal startup permission check", () => {
  it("loads the workspace automatically when Portal supplied an email", async () => {
    getDevelopmentEmail.mockReturnValue("portal@example.com");
    renderToStaticMarkup(<WorkbenchProvider><span /></WorkbenchProvider>);
    effects[0]();
    await vi.waitFor(() => expect(workspace).toHaveBeenCalledOnce());
  });

  it("leaves the login screen without loading a workspace on direct access", () => {
    getDevelopmentEmail.mockReturnValue("");
    renderToStaticMarkup(<WorkbenchProvider><span /></WorkbenchProvider>);
    effects[0]();
    expect(workspace).not.toHaveBeenCalled();
  });
});
