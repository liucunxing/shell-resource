import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import {
  InsightCapabilityResult,
  InvestmentReview,
  investmentPage,
  investmentFactText,
  formatFactSource,
} from "../src/workbench/pages/InsightCapabilityResult";
import { updateInsightGeneration } from "../src/workbench/pages/InsightPanel.jsx";
const dataset = {
  id: "investment-review",
  kind: "table",
  scope_id: "owner:a",
  unit: "CNY",
  title: "核对",
  period: "2025 实际 / 2027 计划",
  note: "跨年参考，按同资源类型与 Sector 比较。",
  fact_ids: [],
  rows: Array.from({ length: 300 }, (_, n) => ({
    id: String(n),
    dealer: `经销商${n}`,
    sector: "B2B",
    resource_type: "MKT",
    historical_actual: 100000,
    plan: 1000000,
    delta: 900000,
    multiple: 10,
    status: n % 2 === 0 ? "review" : "observed",
    reason: "计划投入增加，建议复核",
  })),
};
describe("full investment comparison", () => {
  it("excludes unallocated saved rows from counts, filters and paging without rounding source amounts", () => {
    const saved = { ...dataset, rows: [
      { ...dataset.rows[0], dealer: "未分配对象", plan: 0 },
      { ...dataset.rows[1], dealer: "已分配对象", plan: 125678, status: "limited" },
      { ...dataset.rows[2], dealer: "极小金额对象", plan: 1, status: "observed" },
      { ...dataset.rows[3], dealer: "缺失计划对象", plan: null },
    ] };
    expect(investmentPage(saved, "all", "", 15)).toMatchObject({ total: 2, page: 1, pages: 1 });
    expect(investmentPage(saved, "review", "", 1).total).toBe(0);
    expect(investmentPage(saved, "all", "未分配对象", 1).total).toBe(0);
    const html = renderToString(<InvestmentReview dataset={saved} scopeLabel="本人范围" />);
    expect(html).not.toContain("未分配对象");
    expect(html).not.toContain("缺失计划对象");
    expect(html).toContain("极小金额对象");
    expect(html).toContain("<td>0.00</td>");
    expect(html).toContain("<td>125.68</td>");
    expect(html).toContain("2025资源投入(K$)");
    expect(html).toContain("本次计划(K$)");
    expect(html).toContain("差额(K$)");
    expect(html).not.toContain("万元");
    expect(html).toContain("历史信息不足");
    expect(html).toContain("已核对");
    expect(html).not.toContain("复核说明");
    expect(html).not.toContain("待补充信息");
    expect(html).not.toContain("已核对事实");
    expect(saved.rows[1].plan).toBe(125678);
    expect(saved.rows).toHaveLength(4);
  });
  it("opens interpretation by default and removes the comprehensive budget chart while keeping the budget check", () => {
    const evidence = { scope: { id: "owner:a", label: "本人范围" }, provenance: { kind: "source" }, data_version: "v1", facts: [], datasets: [dataset] };
    const result = {
      headline: "分析", summary: "", preset_id: "comprehensive",
      checks: [{ dimension_id: "completeness", status: "clear", summary: "经销商甲预算已核对。\n经销商乙预算已核对。", fact_ids: [] }],
      blocks: [{ id: "b", kind: "visual", dataset_id: "budget-compare", title: "负责预算与已安排", body: "重复图表", status: "clear", fact_ids: [] }], limitations: [],
    };
    const html = renderToString(<InsightCapabilityResult evidence={evidence} result={result} />);
    expect(html).toContain('<details open="">');
    expect(html).toContain("预算完整性");
    expect(html).toContain("经销商甲预算已核对。\n经销商乙预算已核对。");
    expect(html).not.toContain("负责预算与已安排");
    expect(html).not.toContain("重复图表");
    expect(html).toContain("并非固定前几名或全部经销商排名");
  });
  it("keeps all 300 entries reachable with review entries first", () => {
    const all = Array.from(
      { length: 15 },
      (_, n) => investmentPage(dataset, "all", "", n + 1).rows,
    ).flat();
    expect(new Set(all.map((row) => row.id)).size).toBe(300);
    expect(all.slice(0, 150).every((row) => row.status === "review")).toBe(
      true,
    );
    const reviews = Array.from(
      { length: 8 },
      (_, n) => investmentPage(dataset, "review", "", n + 1).rows,
    ).flat();
    expect(new Set(reviews.map((row) => row.id)).size).toBe(150);
    expect(investmentPage(dataset, "all", "经销商299", 15)).toMatchObject({
      page: 1,
      total: 1,
    });
  });
  it("shows 100k actual versus 1m plan, years, scope and a 10x multiple", () => {
    const html = renderToString(
      <InvestmentReview dataset={dataset} scopeLabel="本人范围" />,
    );
    for (const text of [
      "<td>100.00</td>",
      "<td>1,000.00</td>",
      "<td>900.00</td>",
      "10.0 倍",
      "2025 实际 / 2027 计划",
      "本人范围",
      "下一页",
    ])
      expect(html).toContain(text);
    expect(html.match(/<th scope="row">/g)).toHaveLength(20);
  });
  it("distinguishes missing actual from real zero and never invents a multiple", () => {
    const html = renderToString(
      <InvestmentReview
        scopeLabel="本人范围"
        dataset={{
          ...dataset,
          rows: [
            {
              ...dataset.rows[0],
              historical_actual: null,
              delta: null,
              multiple: null,
            },
            { ...dataset.rows[1], historical_actual: 0, multiple: null },
          ],
        }}
      />,
    );
    expect(html).toContain("缺失");
    expect(html).toContain("<td>0.00</td>");
    expect(html).toContain("不适用（实际为 0）");
  });
  it("shows comparison even if the model returns no blocks, and rejects other scopes", () => {
    const result = {
      headline: "分析",
      summary: "",
      checks: [],
      blocks: [],
      limitations: [],
    };
    const evidence = {
      scope: { id: "owner:a", label: "本人范围" },
      provenance: { kind: "source" },
      data_version: "v1",
      facts: [],
      datasets: [dataset],
    };
    expect(
      renderToString(
        <InsightCapabilityResult result={result} evidence={evidence} />,
      ),
    ).toContain("<td>100.00</td>");
    expect(
      renderToString(
        <InsightCapabilityResult
          result={result}
          evidence={{ ...evidence, scope: { id: "other" } }}
        />,
      ),
    ).not.toContain("<td>100.00</td>");
  });
});
describe("generation failure persistence", () => {
  it("retains a first generation error until explicit retry", () => {
    const failed = updateInsightGeneration(
      { record: null, failure: "" },
      { type: "failed", message: "生成超时" },
    );
    expect(failed).toEqual({ record: null, failure: "生成超时" });
    expect(updateInsightGeneration(failed, { type: "start" })).toEqual({
      record: null,
      failure: "",
    });
  });
  it("retains old results across failure and retry, replacing only on success", () => {
    const record = { headline: "上次成功结果" };
    const failed = updateInsightGeneration(
      { record, basis: "old" },
      { type: "failed" },
    );
    expect(failed.record).toBe(record);
    const retry = updateInsightGeneration(failed, { type: "start" });
    expect(retry.record).toBe(record);
    const next = { headline: "新结果" };
    expect(
      updateInsightGeneration(retry, {
        type: "succeeded",
        record: next,
        basis: "new",
      }),
    ).toEqual({ record: next, basis: "new", failure: "" });
  });
});

describe("readable investment evidence", () => {
  it("formats investment facts without JSON or internal identifiers", () => {
    const text = investmentFactText({
      id: "investment:hash",
      value: JSON.stringify({ ...dataset.rows[0], id: "internalhash" }),
    });
    expect(text).toContain("2025 实际投入 10 万元");
    expect(text).toContain("本次计划 100 万元");
    expect(text).toContain("10.0 倍");
    expect(text).toContain("建议复核");
    expect(text).not.toContain("internalhash");
    expect(text).not.toContain("historical_actual");
    expect(text).not.toContain("{");
    const missing = investmentFactText({
      id: "investment:b",
      value: JSON.stringify({
        historical_actual: null,
        plan: 0,
        multiple: null,
        status: "limited",
      }),
    });
    expect(missing).toContain("2025 实际投入 缺失");
    expect(missing).toContain("本次计划 0 万元");
  });
  it("renders configured thresholds in plain Chinese and handles invalid old data", () => {
    const text = investmentFactText({
      id: "investment-rules",
      value: JSON.stringify({
        increase_multiple: 2,
        decrease_multiple: 0.5,
        absolute_change: 50000,
        version: "internal-v1",
      }),
    });
    for (const term of ["2.0 倍", "50%", "5 万元", "不代表审批结论"])
      expect(text).toContain(term);
    expect(text).not.toContain("internal-v1");
    expect(text).not.toContain("increase_multiple");
    expect(
      investmentFactText({ id: "investment:b", value: "bad json" }),
    ).toContain("暂不可用");
  });
  it("uses a friendly scope label rather than an owner email", () => {
    const evidence = {
      scope: { id: "owner:a", label: "owner:a@example.test" },
      provenance: { kind: "source" },
      data_version: "v1",
      facts: [],
      datasets: [dataset],
    };
    const result = {
      headline: "分析",
      summary: "",
      checks: [],
      blocks: [],
      limitations: [],
    };
    const html = renderToString(
      <InsightCapabilityResult
        result={result}
        evidence={evidence}
        scopeLabel="华东部门工作稿"
      />,
    );
    expect(html).toContain("华东部门工作稿");
    expect(html).not.toContain("a@example.test");
  });
});

it("finds investment rows by customer code and shows code beneath the name", () => {
  const withCode = {
    ...dataset,
    rows: [{ ...dataset.rows[0], dealer: "测试经销商", dealer_id: "SYN001" }],
  };
  expect(investmentPage(withCode, "all", "syn001", 1).rows).toHaveLength(1);
  expect(investmentPage(withCode, "all", "测试经销商", 1).rows).toHaveLength(1);
  const html = renderToString(
    <InvestmentReview dataset={withCode} scopeLabel="本人范围" />,
  );
  expect(html).toContain(
    '测试经销商<small class="ic-dealer-code">SYN001</small>',
  );
  const sameName = {
    ...withCode,
    rows: [{ ...withCode.rows[0], dealer: "SYN001" }],
  };
  expect(
    renderToString(
      <InvestmentReview dataset={sameName} scopeLabel="本人范围" />,
    ),
  ).not.toContain('class="ic-dealer-code"');
});

it("renders a readable fact source while preserving the stored evidence", () => {
  const source =
    '授权工作台；历史批次：{"asOf":"2026","batchId":"data.distributor_sellin_resource_history","count":300,"planningYear":2027}';
  const fact = {
    id: "amount",
    label: "投入",
    value: 100,
    unit: "CNY",
    period: "2027",
    source,
    note: "",
  };
  const evidence = {
    scope: { id: "owner:a", label: "本人范围" },
    provenance: { kind: "source" },
    data_version: "v1",
    facts: [fact],
    datasets: [],
  };
  const result = {
    headline: "分析",
    summary: "",
    checks: [],
    blocks: [
      {
        id: "b",
        kind: "text",
        status: "observed",
        body: "核对说明",
        fact_ids: ["amount"],
      },
    ],
    limitations: [],
  };
  const html = renderToString(
    <InsightCapabilityResult evidence={evidence} result={result} />,
  );
  expect(html).toContain("授权工作台 · 历史参考截至 2026 · 规划年度 2027");
  for (const internal of [
    "batchId",
    "asOf",
    "planningYear",
    "distributor_sellin_resource_history",
    "{",
  ])
    expect(html).not.toContain(internal);
  expect(fact.source).toBe(source);
  expect(formatFactSource("业务确认底表")).toBe("业务确认底表");
  expect(formatFactSource('授权工作台；历史批次：{"bad')).toBe(
    "授权工作台 · 历史参考信息暂不可用",
  );
});

it("hides restricted comparisons without a permission notice", () => {
  const restricted = { ...dataset, rows: [{ ...dataset.rows[0], historical_actual: null, delta: null, multiple: null, status: "limited", reason_code: "resource_restricted" }] };
  const html = renderToString(<InvestmentReview dataset={restricted} scopeLabel="本人范围" />);
  expect(html).toBe("");
  const mixed = { ...dataset, rows: [...restricted.rows, { ...dataset.rows[1], dealer: "可分析对象" }] };
  expect(investmentPage(mixed, "all", "", 1).total).toBe(1);
  const mixedHtml = renderToString(<InvestmentReview dataset={mixed} scopeLabel="本人范围" />);
  expect(mixedHtml).toContain("可分析对象");
  expect(mixedHtml).not.toContain("经销商0");
  expect(mixedHtml).not.toContain("未授权");
});
