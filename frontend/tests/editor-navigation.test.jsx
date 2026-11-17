import { describe, expect, it } from "vitest";
import { normalizeWorkspace, ownInitiatives, resolveEditorTarget, selectWorkspaceView } from "../src/workbench/WorkbenchContext.jsx";
import { navigationFor } from "../src/workbench/WorkbenchApp.jsx";
import E from "../src/workbench/domain/engine.js";
import DATA from "../src/workbench/domain/demo-data.json";

describe("拆分工作台导航", () => {
  it("only offers lead owner navigation when the lead owns a project", () => {
    const identity = { role: "lead", ownerId: "Lead@Example.com" };
    const mine = ownInitiatives([{ id: "mine", ownerId: "lead@example.com" }, { id: "other", ownerId: "other@example.com" }], identity);
    expect(mine.map((item) => item.id)).toEqual(["mine"]);
    expect(navigationFor(identity, true).map((item) => item[0])).toEqual(["department", "department-review", "home", "editor", "portfolio", "submissions"]);
    expect(navigationFor(identity, false).map((item) => item[0])).toEqual(["department", "department-review"]);
    expect(ownInitiatives([{ id: "unowned" }], { role: "lead" })).toEqual([]);
  });
  it("keeps the lead's own draft separate from department submitted snapshots", () => {
    const state = E.createState(DATA, "unallocated");
    const base = state.initiatives[0];
    const snapshot = { ...base, id: "own", ownerId: "lead@example.com", rows: [], workflow: { submitted: false } };
    const colleague = { ...base, id: "other", ownerId: "other@example.com", rows: [] };
    const draft = { ...snapshot, rows: [{ dealerId: "one", amount: 42, note: "" }] };
    const payload = { identity: { role: "lead", ownerId: "lead@example.com", department: [base.department] }, state: { ...state, planningVersion: { id: "v1" }, initiatives: [snapshot, colleague], ownInitiatives: [draft] } };
    const normalized = normalizeWorkspace(payload);
    expect(selectWorkspaceView(normalized.state, normalized.identity, "home").initiatives.map((item) => item.id)).toEqual(["own"]);
    expect(selectWorkspaceView(normalized.state, normalized.identity, "editor").initiatives[0].rows[0].amount).toBe(42);
    const department = selectWorkspaceView(normalized.state, normalized.identity, "department").initiatives;
    expect(department).toHaveLength(2);
    expect(department.find((item) => item.id === "own").rows).toEqual([]);
  });
  const projects = [
    { id: "a", savedAt: "2026-11-16T03:00:00Z", workflow: { editable: true, submitted: false } },
    { id: "b", savedAt: "2026-11-17T03:00:00Z", workflow: { editable: true, submitted: false } },
    { id: "submitted", savedAt: "2026-11-17T04:00:00Z", workflow: { editable: true, submitted: true } },
    { id: "locked", savedAt: "2026-11-17T05:00:00Z", workflow: { editable: false, submitted: false } },
  ];
  it("opens the most recently updated editable draft even without a prior selection", () => {
    expect(resolveEditorTarget(undefined, "", projects)).toBe("b");
    expect(resolveEditorTarget(undefined, "a", projects)).toBe("b");
    expect(resolveEditorTarget(undefined, "old-version", projects)).toBe("b");
  });
  it("honors explicit authorized choices including read-only projects", () => {
    expect(resolveEditorTarget("a", "b", projects)).toBe("a");
    expect(resolveEditorTarget("locked", "b", projects)).toBe("locked");
    expect(resolveEditorTarget("unauthorized", "a", projects)).toBeNull();
  });
  it("respects ownership and recognizes unsaved edits to a previously submitted draft", () => {
    expect(resolveEditorTarget(undefined, "", projects, { canEdit: item => item.id === "a" })).toBe("a");
    expect(resolveEditorTarget(undefined, "", projects, { dirtyIds: new Set(["submitted"]) })).toBe("submitted");
  });
  it("keeps navigation available when all projects are submitted or read-only", () => {
    const readonly = projects.slice(2);
    expect(resolveEditorTarget(undefined, "submitted", readonly)).toBe("submitted");
    expect(resolveEditorTarget(undefined, "old-version", readonly)).toBe("locked");
    expect(resolveEditorTarget(undefined, "a", [])).toBeNull();
  });
  it("handles missing timestamps and ties deterministically without mutating order", () => {
    const missing = [{ id: "a", savedAt: "invalid" }, { id: "b" }];
    expect(resolveEditorTarget(undefined, "", missing)).toBe("a");
    expect(resolveEditorTarget(undefined, "b", missing)).toBe("b");
    expect(missing.map(item => item.id)).toEqual(["a", "b"]);
  });
});
