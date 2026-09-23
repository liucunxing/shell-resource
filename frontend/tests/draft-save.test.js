import { describe, expect, it } from "vitest";
import { mergeSavedDraft } from "../src/workbench/WorkbenchContext.jsx";

describe("save response integration", () => {
  const requested = {
    id: "1",
    revision: 4,
    rows: [{ dealerId: "D1", amount: 20 }],
    otherBudgets: [],
  };
  const saved = { ...requested, revision: 5 };
  it("preserves edits made after the request and leaves them pending", () => {
    const state = {
      initiatives: [
        { ...requested, revision: 5, rows: [{ dealerId: "D1", amount: 30 }] },
      ],
    };
    const result = mergeSavedDraft(state, "1", saved, requested);
    expect(result.edited).toBe(true);
    expect(result.next.initiatives[0].rows[0].amount).toBe(30);
    expect(result.next.initiatives[0].revision).toBeGreaterThan(saved.revision);
    expect(state.initiatives[0].revision).toBe(5);
  });
  it("accepts server-normalized Excel data when no newer edit exists", () => {
    const result = mergeSavedDraft(
      { initiatives: [requested] },
      "1",
      { ...saved, rows: [{ dealerId: "D2", amount: 25 }] },
      requested,
    );
    expect(result.edited).toBe(false);
    expect(result.next.initiatives[0].rows[0].dealerId).toBe("D2");
    expect(result.next.initiatives[0].revision).toBe(5);
  });
});
