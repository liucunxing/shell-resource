import { expect, it } from "vitest";
import { restoredTrial, trialDraftState } from "../src/workbench/domain/trial-draft.js";

function draft() {
  const initiative = {
    id: "1", ownerId: "owner", planningVersionId: "202701", sector: "B2B", budget: 100,
    rows: [{ dealerId: "D1", amount: 70, note: "" }, { dealerId: "D2", amount: 20, note: "依据" }],
    otherBudgets: [{ id: "temporary", amount: 10, reasonId: "reserve", note: "" }],
  };
  initiative.editorState = { trial: trialDraftState(initiative, initiative.rows, "investment", "2025",
    initiative.rows.map(row => ({ ...row, amount: 0 }))) };
  return initiative;
}

it("restores JSON roundtrips despite server ID, ordering and Decimal normalization", () => {
  const i = JSON.parse(JSON.stringify(draft()));
  i.rows.reverse();
  i.rows.forEach(row => { row.amount = String(row.amount); row.id = "server"; });
  i.otherBudgets[0].id = "assigned";
  i.otherBudgets[0].note = null;
  i.editorState.trial.baselineRows.forEach(row => { row.amount = "0.00"; });
  expect(restoredTrial(i)).toMatchObject({ metric: "investment", period: "2025", baselineRows: [
    { dealerId: "D1", amount: 0 }, { dealerId: "D2", amount: 0 },
  ] });
});

it.each([
  i => { i.rows[0].amount++; }, i => { i.rows[0].note = "调整"; },
  i => { i.rows.pop(); }, i => { i.budget++; }, i => { i.otherBudgets[0].amount++; },
  i => { i.id = "2"; }, i => { i.ownerId = "another"; },
  i => { i.planningVersionId = "202702"; }, i => { i.sector = "PCMO"; },
])("does not restore a scheme whose allocations or scope changed (%#)", change => {
  const i = draft();
  change(i);
  expect(restoredTrial(i)).toBeNull();
});

it("rejects malformed recovery rows and accepts old drafts without trial metadata", () => {
  expect(restoredTrial({})).toBeNull();
  const i = draft();
  i.editorState.trial.baselineRows[1].dealerId = "D1";
  expect(restoredTrial(i)).toBeNull();
});
