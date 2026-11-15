import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ResourceCompositionRows } from "../src/workbench/WorkPanel.jsx";

const render = (amounts) => renderToStaticMarkup(<ResourceCompositionRows resources={amounts.map((amount, i) => ({ label: `2025 fee${i}`, amount }))} prefix="2025 " allResources />);
describe("historical expense composition guard", () => {
  it("keeps signed amounts and hides composition bars when any expense is negative", () => {
    const html = render([-10, 20]);
    expect(html).toContain("-10");
    expect(html).toContain("千元人民币");
    expect(html).not.toContain("K$");
    expect(html).toContain("20");
    expect(html).toContain("含负费用");
    expect(html).not.toContain("history-bar-track");
  });
  it.each([[0, 0], [null, 10], [undefined, 10]])("does not fabricate shares for zero or incomplete totals %j", (...values) => {
    const html = render(values);
    expect(html).toContain("暂不显示构成占比");
    expect(html).not.toContain("history-bar-track");
  });
  it("keeps normal complete positive composition unchanged", () => {
    const html = render([25, 75]);
    expect(html).toContain("width:25%");
    expect(html).toContain("width:75%");
    expect(html).toContain("全部资源合计为分母");
  });
});
