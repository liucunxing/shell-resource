import { describe, expect, it } from "vitest";
import { canSynchronizeLatest } from "../src/workbench/pages/EditorPage.jsx";

const state = (patch = {}) => ({
  savedForSync: false,
  hasUnsavedChanges: false,
  errorCount: 0,
  operation: null,
  ...patch,
});

describe("owner save and synchronization flow", () => {
  it("disables synchronization before an explicit successful save", () => {
    expect(canSynchronizeLatest(state())).toBe(false);
  });

  it("enables synchronization only for a clean and valid saved draft", () => {
    expect(canSynchronizeLatest(state({ savedForSync: true }))).toBe(true);
  });

  it("invalidates synchronization after a new edit", () => {
    expect(
      canSynchronizeLatest(
        state({ savedForSync: true, hasUnsavedChanges: true }),
      ),
    ).toBe(false);
  });

  it("keeps synchronization disabled during a request or validation error", () => {
    expect(
      canSynchronizeLatest(state({ savedForSync: true, operation: "save" })),
    ).toBe(false);
    expect(
      canSynchronizeLatest(state({ savedForSync: true, errorCount: 1 })),
    ).toBe(false);
  });
});
