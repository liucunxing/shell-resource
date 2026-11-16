import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SubmissionPage } from "../src/workbench/pages/OverviewPages.jsx";
import { useWorkbench } from "../src/workbench/WorkbenchContext.jsx";
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
  it("does not enable batch submission from a saved draft until the same session reviewed this project", () => {
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
      state: { planningVersion: { id: "202701", name: "本版" } },
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
    expect(renderToStaticMarkup(<SubmissionPage />)).toContain(
      "待核对预算与预留",
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
  });
});
