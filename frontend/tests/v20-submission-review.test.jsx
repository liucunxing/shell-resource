import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SubmissionPage } from "../src/workbench/pages/OverviewPages.jsx";
import { useWorkbench } from "../src/workbench/WorkbenchContext.jsx";
import {
  reserveAcknowledgementKey,
  reserveAcknowledgementFingerprint,
} from "../src/workbench/domain/reserve-review.js";

vi.mock("../src/workbench/WorkbenchContext.jsx", () => ({
  useWorkbench: vi.fn(),
}));
afterEach(() => vi.unstubAllGlobals());

describe("V20 batch submission reserve review", () => {
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
  });
});
