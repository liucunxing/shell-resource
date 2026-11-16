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
  it("allows direct submission before saving", () => {
    expect(canSynchronizeLatest(state())).toBe(true);
  });

  it("enables synchronization only for a clean and valid saved draft", () => {
    expect(canSynchronizeLatest(state({ savedForSync: true }))).toBe(true);
  });

  it("allows automatic saving of new edits", () => {
    expect(
      canSynchronizeLatest(
        state({ savedForSync: true, hasUnsavedChanges: true }),
      ),
    ).toBe(true);
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
