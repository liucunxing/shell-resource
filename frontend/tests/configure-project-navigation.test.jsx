import { describe, expect, it, vi } from "vitest";
import { changePlanningVersion } from "../src/workbench/WorkbenchContext.jsx";

describe("configure projects for a planning version", () => {
  it("opens project configuration immediately for the loaded version", async () => {
    const setPage = vi.fn(), setVersion = vi.fn(), refresh = vi.fn();
    expect(await changePlanningVersion({ id: "202612", currentId: 202612, targetPage: "admin-initiatives", setPage, setVersion, refresh })).toBe(true);
    expect(setPage).toHaveBeenCalledWith("admin-initiatives");
    expect(setVersion).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("loads a different version before requesting project configuration", async () => {
    const setPage = vi.fn(), setVersion = vi.fn(), refresh = vi.fn().mockResolvedValue(true);
    expect(await changePlanningVersion({ id: "202701", currentId: "202612", targetPage: "admin-initiatives", setPage, setVersion, refresh })).toBe(true);
    expect(setVersion).toHaveBeenCalledWith("202701");
    expect(refresh).toHaveBeenCalledWith({ targetPage: "admin-initiatives", expectedVersionId: "202701" });
    expect(setPage).not.toHaveBeenCalled();
  });

  it("does not navigate after a failed version load", async () => {
    const setPage = vi.fn(), setVersion = vi.fn(), refresh = vi.fn().mockResolvedValue(false);
    expect(await changePlanningVersion({ id: "202701", currentId: "202612", targetPage: "admin-initiatives", setPage, setVersion, refresh })).toBe(false);
    expect(setPage).not.toHaveBeenCalled();
  });
});
