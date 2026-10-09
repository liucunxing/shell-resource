import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import {
  InsightCapabilityResult,
  InsightChart,
  formatEvidence,
} from "../src/workbench/pages/InsightCapabilityResult";
const dims = [
  "low_yield",
  "high_yield",
  "concentration",
  "overlap",
  "trend",
  "completeness",
];
const evidence = {
  scope: { id: "owner", label: "本人范围" },
  data_version: "v1",
  provenance: { kind: "source", description: "测试" },
  facts: [],
  datasets: [],
};
const result = {
  headline: "按证据组织的标题",
  summary: "总览",
  preset_id: "structure",
  checks: dims.map((dimension_id) => ({
    dimension_id,
    status: "limited",
    summary: "尚缺判断标准",
    fact_ids: [],
  })),
  blocks: [],
  limitations: ["2025 与 2027 为跨年参考"],
};
describe("capability result", () => {
  it("keeps all six checks visible even without findings", () => {
    const html = renderToString(
      <InsightCapabilityResult result={result} evidence={evidence} />,
    );
    expect(html.match(/<li>/g)).toHaveLength(6);
    expect(html).not.toContain("<details");
    expect(html.match(/待补充信息/g)).toHaveLength(6);
    expect(html).not.toContain("依据不足");
    expect(html).toContain("高 Yield 投入复核");
    expect(html).toContain("本范围多项安排");
    expect(html).toContain("按证据组织的标题");
    expect(html.indexOf("按证据组织的标题")).toBeLessThan(
      html.indexOf("六维检查摘要"),
    );
    expect(html).not.toContain("数据版本");
    expect(html).not.toContain("本人范围");
  });
  it("escapes model text and never interprets html", () => {
    const html = renderToString(
      <InsightCapabilityResult
        result={{ ...result, summary: '<img src=x onerror="alert(1)">' }}
        evidence={evidence}
      />,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
  it("does not render a dataset from another scope", () => {
    const html = renderToString(
      <InsightCapabilityResult
        result={{
          ...result,
          blocks: [
            {
              id: "b",
              kind: "visual",
              title: "图",
              body: "",
              status: "observed",
              dataset_id: "secret",
              fact_ids: [],
            },
          ],
        }}
        evidence={{
          ...evidence,
          datasets: [{ id: "secret", scope_id: "other", title: "不应出现" }],
        }}
      />,
    );
    expect(html).not.toContain("不应出现");
    expect(html).toContain("没有可用的图表证据");
  });
  it("preserves negative over-budget values and true shares above 100 percent", () => {
    const html = renderToString(
      <InsightChart
        dataset={{
          id: "mix",
          kind: "composition",
          title: "预算核对",
          period: "2027",
          note: "",
          unit: "CNY",
          denominator: 100,
          rows: [
            { id: "a", label: "分配", value: 120 },
            { id: "b", label: "差额", value: -20 },
          ],
        }}
      />,
    );
    expect(html).toContain("120%");
    expect(html).toContain("-20");
    expect(html).toContain("负值单列");
  });
  it("distinguishes missing and real zero", () => {
    expect(formatEvidence(null)).toBe("缺失");
    expect(formatEvidence(0, "CNY")).toBe("0 元");
  });
});
