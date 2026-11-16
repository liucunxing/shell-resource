import { describe, expect, it } from "vitest";
import { resolveEditorTarget } from "../src/workbench/WorkbenchContext.jsx";

describe("拆分工作台导航", () => {
  const projects = [{ id: "a" }, { id: "b" }];
  it("returns to the previous project when navigating from another menu", () => {
    expect(resolveEditorTarget(undefined, "a", projects)).toBe("a");
    expect(resolveEditorTarget("b", "a", projects)).toBe("b");
  });
  it("requests project selection when no previous project is accessible", () => {
    expect(resolveEditorTarget(undefined, "", projects)).toBeNull();
    expect(resolveEditorTarget(undefined, "old-version", projects)).toBeNull();
    expect(resolveEditorTarget("unauthorized", "a", projects)).toBeNull();
  });
});
