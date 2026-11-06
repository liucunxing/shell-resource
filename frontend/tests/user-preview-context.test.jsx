import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getPreviewUserEmail, setPreviewUserEmail } from "../src/workbench/userPreview";

// Drive the provider's asynchronous transitions without a browser renderer.
const harness = vi.hoisted(() => ({ slots: [], cursor: 0, effects: [], context: null,
  workspace: vi.fn(), email: "admin@example.test" }));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal()),
  useState: (initial) => {
    const index = harness.cursor++;
    if (!(index in harness.slots)) harness.slots[index] = typeof initial === "function" ? initial() : initial;
    return [harness.slots[index], (value) => {
      harness.slots[index] = typeof value === "function" ? value(harness.slots[index]) : value;
    }];
  },
  useRef: (initial) => {
    const index = harness.cursor++;
    return harness.slots[index] ??= { current: initial };
  },
  useEffect: (effect) => { harness.effects.push(effect); },
}));
vi.mock("../src/workbench/api.js", () => ({
  acceptPortalEmail: vi.fn(), getDevelopmentEmail: () => harness.email,
  setDevelopmentEmail: (email) => { harness.email = email; }, workspace: harness.workspace,
}));
import { WorkbenchProvider, useWorkbench } from "../src/workbench/WorkbenchContext.jsx";

const admin = { email: "admin@example.test", label: "管理员", role: "admin" };
const owner = { email: "owner@example.test", label: "Owner", role: "owner", department: ["MKT"],
  preview: { readOnly: true, actorEmail: admin.email, actorLabel: admin.label } };
const payload = (identity, id = "one") => ({ identity, state: { initiatives: [{ id, department: "MKT", revision: 1 }] } });
function Probe() { harness.context = useWorkbench(); return null; }
function render() {
  harness.cursor = 0;
  harness.effects.length = 0;
  renderToStaticMarkup(<WorkbenchProvider><Probe /></WorkbenchProvider>);
  return harness.context;
}
beforeEach(async () => {
  setPreviewUserEmail("");
  harness.slots = []; harness.email = admin.email;
  harness.workspace.mockReset().mockResolvedValue(payload(admin));
  vi.stubGlobal("document", { querySelector: () => null });
  render();
  await harness.context.refresh();
  render();
});
afterEach(() => { setPreviewUserEmail(""); vi.unstubAllGlobals(); });

it("clears administrator data before loading a target and reloads administrator permissions on exit", async () => {
  let finish;
  harness.workspace.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const switching = harness.context.startUserPreview({ email: owner.email, enabled: true });
  const during = render();
  expect(during.identity).toBeNull();
  expect(during.state.initiatives).toEqual([]);
  expect(during.previewActor.email).toBe(admin.email);
  expect(getPreviewUserEmail()).toBe(owner.email);
  expect(harness.email).toBe(admin.email);
  finish(payload(owner, "owner-only"));
  await expect(switching).resolves.toBe(true);
  expect(render().identity.email).toBe(owner.email);
  harness.workspace.mockResolvedValueOnce(payload(admin, "admin-fresh"));
  await harness.context.stopUserPreview();
  expect(render().identity.email).toBe(admin.email);
  expect(harness.context.state.initiatives[0].id).toBe("admin-fresh");
  expect(getPreviewUserEmail()).toBe("");
});

it("restores the administrator after a disabled or missing target fails", async () => {
  harness.workspace.mockRejectedValueOnce(new Error("用户不可用"));
  await expect(harness.context.startUserPreview({ email: owner.email, enabled: true })).resolves.toBe(false);
  expect(render().identity.email).toBe(admin.email);
  expect(harness.context.previewMode).toBe(false);
  expect(getPreviewUserEmail()).toBe("");
});

it("keeps the exit context when the target loses access during a later refresh", async () => {
  harness.workspace.mockResolvedValueOnce(payload(owner));
  await harness.context.startUserPreview({ email: owner.email, enabled: true });
  render();
  harness.workspace.mockRejectedValueOnce(new Error("权限已变更"));
  await harness.context.refresh();
  expect(render().identity).toBeNull();
  expect(harness.context.previewMode).toBe(true);
  expect(harness.context.previewActor.email).toBe(admin.email);
  await harness.context.stopUserPreview();
  expect(render().identity.email).toBe(admin.email);
});

it("does not accept an unmarked administrator payload as a simulated target", async () => {
  harness.workspace.mockResolvedValueOnce(payload({ ...owner, preview: null }));
  await expect(harness.context.startUserPreview({ email: owner.email, enabled: true })).resolves.toBe(false);
  expect(render().identity.email).toBe(admin.email);
  expect(getPreviewUserEmail()).toBe("");
});
