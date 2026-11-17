import { describe, expect, it } from "vitest";
import { resolveEditorTarget } from "../src/workbench/WorkbenchContext.jsx";

describe("拆分工作台导航", () => {
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
