import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SubmissionPage } from "../src/workbench/pages/OverviewPages.jsx";
import { EditorPage } from "../src/workbench/pages/EditorPage.jsx";
import { useWorkbench } from "../src/workbench/WorkbenchContext.jsx";
import E from "../src/workbench/domain/engine.js";
import D from "../src/workbench/domain/demo-data.json";
import {
  reserveAcknowledgementKey,
  reserveAcknowledgementFingerprint,
  hasReserveAcknowledgement,
  hasCurrentVersionSubmission,
} from "../src/workbench/domain/reserve-review.js";

vi.mock("../src/workbench/WorkbenchContext.jsx", () => ({
  useWorkbench: vi.fn(),
}));
afterEach(() => vi.unstubAllGlobals());

describe("V20 batch submission reserve review", () => {
  it("reuses current-version submissions across sessions and draft edits, but not copied baselines", () => {
    const identity = { email: "owner@example.test", role: "owner" };
    const storage = { getItem: () => null };
    const submitted = { id: "p", budget: 100, otherBudgets: [],
      workflow: { publicationId: "12", submitted: false, editable: true } };
    expect(hasReserveAcknowledgement(identity, "202612", submitted, storage)).toBe(true);
    expect(hasReserveAcknowledgement(identity, "202612", {
      ...submitted, budget: 200, otherBudgets: [{ amount: 50, reasonId: "reserve" }],
    }, storage)).toBe(true);
    expect(hasReserveAcknowledgement(identity, "202701", {
      ...submitted, publicationId: "source-publication", workflow: { publicationId: null },
    }, storage)).toBe(false);
    expect(hasCurrentVersionSubmission({ publicationId: "local-demo-submission" })).toBe(true);
    expect(hasCurrentVersionSubmission({ publishedRevision: 2 })).toBe(false);
  });
  it.each([undefined, "202612"])("requires reserve review but no change reason for batch submission (source: %s)", (sourceVersionId) => {
    const identity = { email: "owner@example.test", role: "owner" };
    const item = {
      id: "p",
      name: "本版项目",
      budget: 100,
      rows: [{ dealerId: "d", amount: 90 }],
      otherBudgets: [{ id: "r", amount: 10, reasonId: "waiting" }],
      workflow: { editable: true },
      status: "draft",
    };
    const values = new Map();
    vi.stubGlobal("sessionStorage", {
      getItem: (key) => values.get(key) || null,
    });
    const context = {
      identity,
      view: { initiatives: [item] },
      state: { planningVersion: { id: "202701", name: "本版", sourceVersionId } },
      savedForSyncIds: new Set(["p"]),
      editorOperations: {},
      navigate: vi.fn(),
      publish: vi.fn(),
    };
    useWorkbench.mockReturnValue(context);
    const submitButton = (html) =>
      html.match(/<button[^>]*>提交本版所有已配平项目<\/button>/)?.[0];
    expect(submitButton(renderToStaticMarkup(<SubmissionPage />))).toContain(
      'disabled=""',
    );
    values.set(
      reserveAcknowledgementKey(identity, "202701", item.id),
      reserveAcknowledgementFingerprint(item),
    );
    expect(
      submitButton(renderToStaticMarkup(<SubmissionPage />)),
    ).not.toContain('disabled=""');
    item.otherBudgets[0].amount = 11;
    expect(submitButton(renderToStaticMarkup(<SubmissionPage />))).toContain(
      'disabled=""',
    );
    expect(context.publish).not.toHaveBeenCalled();
    item.otherBudgets[0].amount = 10;
    values.clear();
    item.workflow.publicationId = "12";
    const resumed = renderToStaticMarkup(<SubmissionPage />);
    expect(submitButton(resumed)).not.toContain('disabled=""');
    expect(resumed).not.toContain("待核对预算与预留");
    item.workflow.editable = false;
    expect(submitButton(renderToStaticMarkup(<SubmissionPage />))).toContain('disabled=""');
  });
});

it("allows blank-reason resubmission in a copied version before department confirmation", () => {
  const state = E.createState(D, "working");
  const item = state.initiatives[0];
  const identity = { role: "owner", email: "owner@example.test", ownerId: item.ownerId,
    department: [item.department] };
  item.workflow = { editable: true, submitted: false, publicationId: "prior-submission" };
  item.changeReason = "";
  item.otherBudgets = [];
  item.rows = [{ dealerId: D.dealers[0].id, amount: item.budget }];
  state.planningVersion = { id: "202701", sourceVersionId: "202612" };
  const context = { state, identity, data: D, view: E.selectView(state, identity), apiMode: true,
    initiativeId: item.id, dirtyIds: new Set([item.id]), savedForSyncIds: new Set(),
    editorOperations: {}, notify: vi.fn(), loadDistributorDirectory: vi.fn() };
  useWorkbench.mockReturnValue(context);
  const html = renderToStaticMarkup(<EditorPage />);
  const submit = html.match(/<button[^>]*>提交到 202701 →<\/button>/)?.[0];
  expect(submit).toBeTruthy();
  expect(submit).not.toContain('disabled=""');
  expect(html).not.toContain("请填写本版变更原因");

  item.rows[0].amount -= 1;
  context.view = E.selectView(state, identity);
  const unbalanced = renderToStaticMarkup(<EditorPage />);
  expect(unbalanced.match(/<button[^>]*>提交到 202701 →<\/button>/)?.[0]).toContain('disabled=""');

  item.workflow.editable = false;
  context.view = E.selectView(state, identity);
  const locked = renderToStaticMarkup(<EditorPage />);
  expect(locked).not.toContain(">保存草稿<");
  expect(locked).not.toContain(">提交到 202701 →<");
});
