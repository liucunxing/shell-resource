import { afterEach, describe, expect, it, vi } from "vitest";
import { saveDraft } from "../src/workbench/api.js";
import E from "../src/workbench/domain/engine.js";
import data from "../src/workbench/domain/demo-data.json";
import {
  hasReserveAcknowledgement,
  reserveAcknowledgementFingerprint,
  restoredEditorStep,
} from "../src/workbench/domain/reserve-review.js";

const identity = { email: "owner@example.test", role: "owner" };
const draft = () => ({
  id: "1", ownerId: identity.email, planningVersionId: "202701", budget: 100,
  rows: [{ dealerId: "D1", amount: 70 }],
  otherBudgets: [
    { id: "temporary-a", reasonId: "reserve", amount: 20, note: "待定" },
    { id: "temporary-b", reasonId: "other", amount: 10, note: null },
  ],
});
function acknowledged(step = 3) {
  const item = draft();
  item.editorState = { step, reserveAcknowledgement: reserveAcknowledgementFingerprint(item) };
  return item;
}
afterEach(() => vi.unstubAllGlobals());

describe("saved editor progress and reserve review", () => {
  it("restores the saved step and review without any browser session storage", () => {
    vi.stubGlobal("sessionStorage", undefined);
    const item = acknowledged();
    expect(hasReserveAcknowledgement(identity, "202701", item)).toBe(true);
    expect(restoredEditorStep(identity, "202701", item, true)).toBe(3);
  });

  it("keeps review after a save assigns reserve IDs, normalizes notes and reorders rows", () => {
    const item = acknowledged();
    item.otherBudgets = item.otherBudgets.map((row, index) => ({
      ...row, id: String(index + 100), amount: String(row.amount), note: row.note || "",
    })).reverse();
    expect(hasReserveAcknowledgement(identity, "202701", item)).toBe(true);
    expect(restoredEditorStep(identity, "202701", item, true)).toBe(3);
  });

  it.each([
    ["budget", (item) => { item.budget += 1; }],
    ["reserve amount", (item) => { item.otherBudgets[0].amount += 1; }],
    ["reserve purpose", (item) => { item.otherBudgets[0].reasonId = "other"; }],
    ["reserve explanation", (item) => { item.otherBudgets[0].note = "新说明"; }],
    ["initiative", (item) => { item.id = "2"; }],
    ["owner", (item) => { item.ownerId = "other@example.test"; }],
    ["version", (item) => { item.planningVersionId = "202702"; }],
  ])("requires review again after changing %s", (_name, change) => {
    const item = acknowledged();
    change(item);
    expect(hasReserveAcknowledgement(identity, "202701", item)).toBe(false);
    expect(restoredEditorStep(identity, "202701", item, true)).toBe(1);
  });

  it("keeps reserve review when only dealer allocations change", () => {
    const item = acknowledged();
    item.rows[0].amount = 60;
    expect(hasReserveAcknowledgement(identity, "202701", item)).toBe(true);
  });

  it("honors a saved unchecked checkbox over an old session acknowledgement", () => {
    const item = acknowledged(1);
    const oldAcknowledgement = item.editorState.reserveAcknowledgement;
    item.editorState.reserveAcknowledgement = "";
    vi.stubGlobal("sessionStorage", { getItem: () => oldAcknowledgement });
    expect(hasReserveAcknowledgement(identity, "202701", item)).toBe(false);
  });

  it("honors an explicitly cleared editor state over a stale session acknowledgement", () => {
    const item = acknowledged();
    const oldAcknowledgement = item.editorState.reserveAcknowledgement;
    item.editorState = null;
    vi.stubGlobal("sessionStorage", { getItem: () => oldAcknowledgement });
    expect(hasReserveAcknowledgement(identity, "202701", item)).toBe(false);
    expect(restoredEditorStep(identity, "202701", item, true)).toBe(1);
  });

  it("lets a read-only viewer restore the saved step without granting confirmation", () => {
    const item = draft();
    item.editorState = { step: 3, reserveAcknowledgement: "" };
    expect(restoredEditorStep(identity, "202701", item, false)).toBe(3);
    expect(hasReserveAcknowledgement(identity, "202701", item)).toBe(false);
  });

  it("remembers a submitted project's chosen step without changing its allocation status", () => {
    const state = E.createState(data, "working");
    const item = state.initiatives[0];
    const owner = { ...identity, ownerId: item.ownerId, department: [item.department] };
    item.status = "completed";
    item.workflow = { editable: true, submitted: true, publicationId: "publication-1" };
    const revision = item.revision;
    E.updateInitiative(state, item.id, { editorState: { step: 2, reserveAcknowledgement: "" } }, owner, data);
    expect(item.revision).toBe(revision);
    expect(item.status).toBe("completed");
    expect(restoredEditorStep(owner, "202701", item, true)).toBe(2);
  });
});

describe("editor state API serialization", () => {
  it.each([acknowledged().editorState, null])("sends metadata and explicit clearing with the same revision-protected draft", async (editorState) => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ code: 200, data: { revision: 9 } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await saveDraft("1", { ...draft(), editorState, revision: 8 }, 8);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/workbench/initiatives/1/draft");
    expect(options.method).toBe("PUT");
    expect(JSON.parse(options.body)).toMatchObject({
      expected_revision: 8, editorState,
      rows: [{ dealerId: "D1", amount: 70, note: "" }],
    });
  });
});
