import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { submittedVersionItems } from "../src/workbench/domain/version-baseline.js";
import { sdGroupsWithComparison, sdPresentationGroups } from "../src/workbench/pages/SdAnalysis.jsx";
import { V20OrganizationSummary } from "../src/workbench/pages/V20OrganizationSummary.jsx";

const source = (publications = {}) => ({ state: { initiatives: [{ id: "1", initiativeKey: "stable", name: "项目", sector: "PCMO", enabled: true, rows: [{ dealerId: "live", sd: "LIVE-SD", amount: 999 }], otherBudgets: [], workflow: { submitted: false, requiresResubmission: true } }], publications } });
const snapshot = { id: "1", initiativeKey: "stable", name: "项目", sector: "PCMO", budget: 100, rows: [{ dealerId: "removed", sd: "OLD-SD", rsm: "OLD-RSM", amount: 100 }], otherBudgets: [] };

describe("V19 submitted comparison baseline", () => {
  it("ignores newer unsaved source drafts and keeps submitted attribution", () => {
    const rows = submittedVersionItems(source({ "1": [{ initiative: { ...snapshot, department: "ICE" }, publishedRevision: 4 }] }));
    expect(rows[0].rows).toEqual(snapshot.rows);
    expect(rows[0].department).toBe("ICE");
    expect(rows[0].publishedRevision).toBe(4);
    expect(rows[0].allocationVisible).toBe(true);
  });
  it("does not treat a never-submitted source project as zero", () => {
    const previous = submittedVersionItems(source());
    const groups = sdGroupsWithComparison([{ ...snapshot, id: "2" }], previous, [], "sd", "c3", "2025");
    expect(previous[0].allocationVisible).toBe(false);
    expect(groups[0].comparison.changeLabel).toBe("不可比较");
    expect(groups[0].comparison.previousAmount).toBeNull();
  });
  it.each(["sd", "rsm"])("renders a removed %s as a decrease in investment amount", (dimension) => {
    const previous = submittedVersionItems(source({ "1": [{ initiative: snapshot }] }));
    const groups = sdGroupsWithComparison([{ ...snapshot, id: "2", rows: [{ dealerId: "new", sd: "NEW-SD", rsm: "NEW-RSM", amount: 100 }] }], previous, [], dimension, "c3", "2025");
    const old = groups.find((group) => group.key === (dimension === "sd" ? "OLD-SD" : "OLD-RSM"));
    expect(old.amount).toBe(0);
    expect(old.comparison.previousAmount).toBe(100);
    const html = renderToStaticMarkup(<V20OrganizationSummary
      {...sdPresentationGroups(groups)} countScope="selected" groupBy={dimension}
      period="2025" basis="c3" threshold={5} redThreshold={10}
      sourceVersionId="202701" rowId={(key) => key} onOpen={() => {}}
    />);
    expect(html).toMatch(/data-column="delta"[^>]*>−0\.0</);
    expect(html).toMatch(/data-column="delta"[^>]*>\+0\.0</);
    expect(html).not.toContain("-100.0%");
  });
  it("keeps an inaccessible source allocation unavailable despite a stale snapshot", () => {
    const payload = source({ "1": [{ initiative: snapshot }] }); payload.state.initiatives[0].allocationVisible = false;
    expect(submittedVersionItems(payload)[0]).toMatchObject({ allocationVisible: false, baselineAvailable: false, rows: [] });
  });
});
