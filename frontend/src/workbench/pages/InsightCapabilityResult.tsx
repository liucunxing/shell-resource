import { useState } from "react";
import "./insight-capability.css";
export type Status = "review" | "clear" | "observed" | "limited";
export type Dimension =
  | "low_yield"
  | "high_yield"
  | "concentration"
  | "overlap"
  | "trend"
  | "completeness";
type Cell = string | number | null;
interface Axis {
  label: string;
  unit: string;
  period: string;
  cutoff: number;
  cutoff_method: string;
}
export interface Dataset {
  id: string;
  kind: "comparison" | "composition" | "ranked_bar" | "quadrant" | "table";
  title: string;
  scope_id: string;
  unit: string;
  period: string;
  note: string;
  fact_ids: string[];
  rows: ({ id: string } & Record<string, Cell>)[];
  denominator?: number;
  x?: Axis;
  y?: Axis;
  population_count?: number;
  excluded_count?: number;
  cohort_label?: string;
  cutoff_note?: string;
  columns?: { key: string; label: string; unit: string }[];
}
export interface Evidence {
  scope: { id: string; label: string };
  data_version: string;
  provenance: { kind: string; description: string };
  datasets: Dataset[];
  facts: {
    id: string;
    label: string;
    value: Cell;
    unit: string;
    period: string;
    source: string;
    note: string;
  }[];
}
export interface CapabilityResult {
  headline: string;
  summary: string;
  preset_id: string;
  checks: {
    dimension_id: Dimension;
    status: Status;
    summary: string;
    fact_ids: string[];
  }[];
  blocks: {
    id: string;
    kind: string;
    title: string;
    body: string;
    status: Status;
    dataset_id: string | null;
    fact_ids: string[];
  }[];
  limitations: string[];
}
const dimensions: Record<Dimension, string> = {
  low_yield: "低 Yield 投入复核",
  high_yield: "高 Yield 投入复核",
  concentration: "投入集中度",
  overlap: "本范围多项安排",
  trend: "投入与业绩趋势匹配",
  completeness: "预算完整性",
};
const statuses: Record<Status, string> = {
  review: "建议复核",
  clear: "本项检查通过",
  observed: "已核对事实",
  limited: "待补充信息",
};
export function formatEvidence(value: Cell | undefined, unit = ""): string {
  if (value == null) return "缺失";
  if (typeof value !== "number") return value;
  if (unit === "ratio")
    return `${(value * 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}%`;
  if (unit === "CNY")
    return `${(value / 10000).toLocaleString("zh-CN", { maximumFractionDigits: 6 })} 万元`;
  return `${value.toLocaleString("zh-CN", { minimumFractionDigits: unit === "multiple" ? 1 : 0, maximumFractionDigits: unit === "multiple" ? 1 : 2 })}${unit === "multiple" ? " 倍" : unit === "count" ? "" : unit ? ` ${unit}` : ""}`;
}
export function formatInsightCopy(value: Cell | undefined): string {
  const text = String(value ?? "");
  return text
    .replace(/([+\-−]?\d[\d,]*(?:\.\d+)?)\s*(万元|元)/g, (_, value, unit) =>
      `${(Number(value.replaceAll(",", "").replace("−", "-")) / (unit === "元" ? 10000 : 1)).toLocaleString("zh-CN", { maximumFractionDigits: 6 })}万元`,
    )
    .replace(/((?:Yield|投入产出比)[^。；;，\n]{0,24}?)([+\-]?\d+(?:\.\d+)?)\s*倍/gi, (_, prefix, value) => `${prefix}${Number(value).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false })}倍`);
}
const investmentPageSize = 20;
export function investmentPage(
  dataset: Dataset,
  status: string,
  query: string,
  requestedPage: number,
) {
  const search = query.trim().toLocaleLowerCase();
  const rank: Record<string, number> = { review: 0, limited: 1, observed: 2 };
  const filtered = dataset.rows
    .filter(
      (row) =>
        (status === "all" || row.status === status) &&
        (!search ||
          [row.dealer, row.dealer_id, row.sector, row.resource_type].some(
            (value) =>
              String(value ?? "")
                .toLocaleLowerCase()
                .includes(search),
          )),
    )
    .sort(
      (a, b) => (rank[String(a.status)] ?? 3) - (rank[String(b.status)] ?? 3),
    );
  const pages = Math.max(1, Math.ceil(filtered.length / investmentPageSize));
  const page = Math.min(Math.max(1, requestedPage), pages);
  return {
    rows: filtered.slice(
      (page - 1) * investmentPageSize,
      page * investmentPageSize,
    ),
    total: filtered.length,
    pages,
    page,
  };
}
export function InvestmentReview({
  dataset,
  scopeLabel,
}: {
  dataset: Dataset;
  scopeLabel: string;
}) {
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const shown = investmentPage(dataset, status, query, page);
  const count = (value: string) =>
    dataset.rows.filter((row) => row.status === value).length;
  return (
    <section className="ic-investment" aria-label="历史实际投入与计划核对">
      <h3>历史实际投入与计划核对</h3>
      <p>
        {scopeLabel} · {dataset.period}
      </p>
      <p className="ic-caption">
        按金额和复核规则计算，完整名单不受分析摘要篇幅影响。标记仅供复核，不代表分配错误。
      </p>
      <p className="ic-caption">{formatInsightCopy(dataset.note)}</p>
      <p>
        共 {dataset.rows.length} 项 · 建议复核 {count("review")} 项 · 待补充信息{" "}
        {count("limited")} 项
      </p>
      <div className="ic-review-controls">
        <label className="form-field">
          核对状态
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="all">全部</option>
            <option value="review">建议复核</option>
            <option value="limited">待补充信息</option>
            <option value="observed">已核对事实</option>
          </select>
        </label>
        <label className="form-field">
          查找经销商名称、代码、Sector 或资源类型
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="输入关键词"
          />
        </label>
      </div>
      <div
        className="ic-review-scroll"
        tabIndex={0}
        role="region"
        aria-label="投入核对明细，可横向滚动"
      >
        <table className="ic-review-table">
          <thead>
            <tr>
              {[
                "经销商",
                "Sector",
                "资源类型",
                "2025 实际投入（万元）",
                "本次计划（万元）",
                "差额（万元）",
                "计划 / 实际",
                "核对状态",
                "复核说明",
              ].map((label) => (
                <th key={label} scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.rows.map((row) => (
              <tr key={row.id}>
                <th scope="row">
                  {row.dealer}
                  {row.dealer_id && row.dealer_id !== row.dealer && (
                    <small className="ic-dealer-code">{row.dealer_id}</small>
                  )}
                </th>
                <td>{row.sector || "未指定"}</td>
                <td>{row.resource_type}</td>
                <td>{formatEvidence(row.historical_actual, "CNY")}</td>
                <td>{formatEvidence(row.plan, "CNY")}</td>
                <td>{formatEvidence(row.delta, "CNY")}</td>
                <td>
                  {row.multiple == null
                    ? row.historical_actual === 0
                      ? "不适用（实际为 0）"
                      : "缺失"
                    : formatEvidence(row.multiple, "multiple")}
                </td>
                <td>
                  <span className={`ic-status ${row.status}`}>
                    {statuses[row.status as Status] || row.status}
                  </span>
                </td>
                <td>{formatInsightCopy(row.reason)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.total === 0 && <p>没有匹配的核对记录。</p>}
      <nav className="ic-review-pagination" aria-label="投入核对分页">
        <button
          className="button small"
          disabled={shown.page === 1}
          onClick={() => setPage(shown.page - 1)}
        >
          上一页
        </button>
        <span aria-live="polite">
          第 {shown.page} / {shown.pages} 页 · 筛选后 {shown.total} 项
        </span>
        <button
          className="button small"
          disabled={shown.page === shown.pages}
          onClick={() => setPage(shown.page + 1)}
        >
          下一页
        </button>
      </nav>
    </section>
  );
}
function EvidenceRows({ dataset }: { dataset: Dataset }) {
  const columns =
    dataset.columns ||
    (dataset.kind === "quadrant"
      ? [
          { key: "label", label: "对象", unit: "" },
          {
            key: "x",
            label: `${dataset.x?.period} ${dataset.x?.label}`,
            unit: dataset.x?.unit || "",
          },
          {
            key: "y",
            label: `${dataset.y?.period} ${dataset.y?.label}`,
            unit: dataset.y?.unit || "",
          },
          { key: "group", label: "分组", unit: "" },
        ]
      : [
          { key: "label", label: "对象／时期", unit: "" },
          { key: "value", label: "金额／指标", unit: dataset.unit },
        ]);
  return (
    <div className="ic-evidence-rows">
      {dataset.rows.map((row) => (
        <dl key={row.id}>
          {columns.map((col) => (
            <div key={col.key}>
              <dt>{col.label}</dt>
              <dd>{formatEvidence(row[col.key], col.unit)}</dd>
            </div>
          ))}
        </dl>
      ))}
    </div>
  );
}
function Quadrant({ dataset }: { dataset: Dataset }) {
  const [selected, setSelected] = useState(dataset.rows[0]?.id);
  const row =
    dataset.rows.find((item) => item.id === selected) || dataset.rows[0];
  if (!dataset.x || !dataset.y) return <EvidenceRows dataset={dataset} />;
  const xs = dataset.rows.map((item) => Number(item.x)),
    ys = dataset.rows.map((item) => Number(item.y));
  const minX = Math.min(0, ...xs, dataset.x.cutoff),
    maxX = Math.max(1, ...xs, dataset.x.cutoff),
    minY = Math.min(0, ...ys, dataset.y.cutoff),
    maxY = Math.max(1, ...ys, dataset.y.cutoff);
  const px = (x: number) => 38 + ((x - minX) / (maxX - minX)) * 300;
  const py = (y: number) => 240 - ((y - minY) / (maxY - minY)) * 215;
  const coincident = dataset.rows.filter(
    (item) => item.x === row.x && item.y === row.y,
  ).length;
  return (
    <>
      <p>
        {dataset.cohort_label} · 纳入 {dataset.rows.length}／候选{" "}
        {dataset.population_count}，排除 {dataset.excluded_count}
      </p>
      <p>
        {dataset.y.period} {dataset.y.label}（
        {dataset.y.unit === "CNY" ? "万元" : dataset.y.unit}）
      </p>
      <svg
        className="ic-quadrant"
        viewBox="0 0 370 275"
        role="group"
        aria-label={dataset.title}
      >
        <path d="M38 25V240H338" fill="none" stroke="#777" />
        <path
          d={`M${px(dataset.x.cutoff)} 25V240 M38 ${py(dataset.y.cutoff)}H338`}
          stroke="#999"
          strokeDasharray="4 4"
        />
        <text x="38" y="258">
          {formatEvidence(minX, dataset.x.unit)}
        </text>
        <text x="338" y="258" textAnchor="end">
          {formatEvidence(maxX, dataset.x.unit)}
        </text>
        <text x="36" y="20">
          {formatEvidence(maxY, dataset.y.unit)}
        </text>
        {dataset.rows.map((item) => (
          <circle
            key={item.id}
            cx={px(Number(item.x))}
            cy={py(Number(item.y))}
            r={item.id === row.id ? 7 : 5}
            fill={item.id === row.id ? "#ffcd00" : "#777"}
            stroke="#222"
            tabIndex={0}
            role="button"
            aria-label={`${item.label}，${formatEvidence(item.x, dataset.x?.unit)}，${formatEvidence(item.y, dataset.y?.unit)}`}
            onClick={() => setSelected(item.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setSelected(item.id);
              }
            }}
          />
        ))}
      </svg>
      <p>
        {dataset.x.period} {dataset.x.label} · 分界{" "}
        {formatEvidence(dataset.x.cutoff, dataset.x.unit)}／
        {formatEvidence(dataset.y.cutoff, dataset.y.unit)}
      </p>
      <p>{dataset.cutoff_note}</p>
      <label className="form-field">
        选择对象
        <select
          value={row.id}
          onChange={(event) => setSelected(event.target.value)}
        >
          {dataset.rows.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label || item.id}
            </option>
          ))}
        </select>
      </label>
      <p className="ic-selected">
        {row.label}：{formatEvidence(row.x, dataset.x.unit)} ×{" "}
        {formatEvidence(row.y, dataset.y.unit)} · {row.group}
        {coincident > 1
          ? ` · 同坐标 ${coincident} 个对象，可通过列表逐一选择`
          : ""}
      </p>
      <details>
        <summary>完整队列（{dataset.rows.length}）</summary>
        <EvidenceRows dataset={dataset} />
      </details>
    </>
  );
}
export function InsightChart({ dataset }: { dataset: Dataset }) {
  const [expanded, setExpanded] = useState(false);
  const isBars = ["comparison", "composition", "ranked_bar"].includes(
    dataset.kind,
  );
  const values = dataset.rows
    .map((row) => row.value)
    .filter((v): v is number => typeof v === "number");
  const max = Math.max(1, ...values.map(Math.abs), dataset.denominator || 0);
  const shown =
    dataset.kind === "ranked_bar" && !expanded
      ? dataset.rows.slice(0, 5)
      : dataset.rows;
  return (
    <figure className="ic-chart">
      <figcaption>{dataset.title}</figcaption>
      <p>
        {dataset.period} · {formatInsightCopy(dataset.note)}
      </p>
      {dataset.denominator != null && (
        <p>占比分母：{formatEvidence(dataset.denominator, dataset.unit)}</p>
      )}
      {dataset.kind === "quadrant" ? (
        <Quadrant dataset={dataset} />
      ) : isBars ? (
        <>
          <div className="ic-bars">
            {shown.map((row, index) => (
              <div className="ic-bar-row" key={row.id}>
                <span>{row.label || row.id}</span>
                <strong>
                  {formatEvidence(row.value, dataset.unit)}
                  {typeof row.value === "number" && dataset.denominator
                    ? ` · ${formatEvidence(row.value / dataset.denominator, "ratio")}`
                    : ""}
                </strong>
                <div className="ic-bar-track" aria-hidden="true">
                  <i
                    className={
                      typeof row.value === "number" && row.value < 0
                        ? "negative"
                        : dataset.kind === "comparison" && index === 0
                          ? "historical"
                          : ""
                    }
                    style={{
                      width: `${typeof row.value === "number" ? (Math.abs(row.value) / max) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          {dataset.kind === "ranked_bar" && dataset.rows.length > 5 && (
            <button
              className="button small"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? "收起" : `查看完整列表（${dataset.rows.length}）`}
            </button>
          )}
          <p className="ic-caption">
            零基线金额条 · 显示 {shown.length}／{dataset.rows.length} 项
            {values.some((v) => v < 0) ? " · 负值单列，未作百分比堆叠" : ""}
          </p>
        </>
      ) : (
        <EvidenceRows dataset={dataset} />
      )}
    </figure>
  );
}
export function investmentFactText(
  fact: Evidence["facts"][number],
): string | null {
  if (fact.id !== "investment-rules" && !fact.id.startsWith("investment:"))
    return null;
  let values: Record<string, Cell>;
  try {
    const parsed: unknown = JSON.parse(String(fact.value));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("invalid");
    values = parsed as Record<string, Cell>;
  } catch {
    return "投入核对详情暂不可用，请查看完整核对名单。";
  }
  if (fact.id === "investment-rules") {
    return `当前投入复核规则：计划达到历史实际的 ${formatEvidence(values.increase_multiple, "multiple")}及以上，且增加至少 ${formatEvidence(values.absolute_change, "CNY")}；或计划降至历史实际的 ${formatEvidence(values.decrease_multiple, "ratio")}及以下，且减少至少 ${formatEvidence(values.absolute_change, "CNY")}，建议复核。历史有投入、本范围未分配时也建议复核。阈值用于提示，不代表审批结论。`;
  }
  const multiple =
    values.multiple == null
      ? values.historical_actual === 0
        ? "不适用（实际为 0）"
        : "缺失"
      : formatEvidence(values.multiple, "multiple");
  return `${values.dealer || "经销商名称缺失"} · ${values.sector || "Sector 未明确"} · ${values.resource_type || "资源类型未明确"}：2025 实际投入 ${formatEvidence(values.historical_actual, "CNY")}；本次计划 ${formatEvidence(values.plan, "CNY")}；差额 ${formatEvidence(values.delta, "CNY")}；计划 / 实际 ${multiple}。${statuses[values.status as Status] || "待补充信息"}：${values.reason || "暂无说明"}`;
}
export function formatFactSource(source: string): string {
  const marker = "历史批次：";
  const index = source.indexOf(marker);
  if (index < 0) return source;
  const suffix = source.slice(index + marker.length).trim();
  if (!suffix.startsWith("{")) return source;
  const prefix = source.slice(0, index).replace(/[；;\s]+$/, "");
  try {
    const parsed: unknown = JSON.parse(suffix);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("invalid");
    const values = parsed as Record<string, unknown>;
    const scalar = (value: unknown) =>
      typeof value === "string" || typeof value === "number"
        ? String(value)
        : "";
    const asOf = scalar(values.asOf);
    const year = scalar(values.planningYear);
    return [
      prefix,
      asOf ? `历史参考截至 ${asOf}` : "历史参考日期未提供",
      year ? `规划年度 ${year}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  } catch {
    return [prefix, "历史参考信息暂不可用"].filter(Boolean).join(" · ");
  }
}
function FactReferences({
  ids,
  evidence,
}: {
  ids: string[];
  evidence: Evidence;
}) {
  const facts = evidence.facts.filter((fact) => ids.includes(fact.id));
  if (!facts.length) return null;
  return (
    <details className="ic-facts">
      <summary>核对依据（{facts.length}）</summary>
      {facts.map((fact) => (
        <p key={fact.id}>
          <strong>
            {investmentFactText(fact) ??
              `${fact.label}：${formatEvidence(fact.value, fact.unit)}`}
          </strong>
          <br />
          {fact.period} · {formatFactSource(fact.source)}
          {fact.note && ` · ${formatInsightCopy(fact.note)}`}
        </p>
      ))}
    </details>
  );
}
export function InsightCapabilityResult({
  result,
  evidence,
  scopeLabel,
}: {
  result: CapabilityResult;
  evidence: Evidence;
  scopeLabel?: string;
}) {
  const investment = evidence.datasets.find(
    (dataset) =>
      dataset.id === "investment-review" &&
      dataset.scope_id === evidence.scope.id,
  );
  return (
    <section className="ic-result">
      <h3>{formatInsightCopy(result.headline)}</h3>
      <p className="ic-body">{formatInsightCopy(result.summary)}</p>
      {evidence.provenance.kind === "synthetic" && (
        <p className="note-box">合成数据：{evidence.provenance.description}</p>
      )}
      {investment && (
        <InvestmentReview
          key={`${evidence.data_version}:${investment.scope_id}`}
          dataset={investment}
          scopeLabel={
            scopeLabel ||
            (evidence.scope.label.startsWith("owner:")
              ? "本人全部 Initiative"
              : evidence.scope.label.startsWith("initiative:")
                ? "当前 Initiative"
                : evidence.scope.label)
          }
        />
      )}
      {investment && <h3>分析解读</h3>}
      <ul className="ic-checks" aria-label="六维检查摘要">
        {[...result.checks]
          .sort(
            (a, b) =>
              Number(b.status === "review") - Number(a.status === "review"),
          )
          .map((check) => (
            <li key={check.dimension_id}>
              <div>
                <strong>{dimensions[check.dimension_id]}</strong>
                <span className={`ic-status ${check.status}`}>
                  {statuses[check.status]}
                </span>
              </div>
              {investment && ["clear", "observed"].includes(check.status) ? (
                <details>
                  <summary>查看本项说明</summary>
                  <p>{formatInsightCopy(check.summary)}</p>
                </details>
              ) : (
                <p>{formatInsightCopy(check.summary)}</p>
              )}
            </li>
          ))}
      </ul>
      {result.blocks.map((block) => {
        const dataset = evidence.datasets.find(
          (item) =>
            item.id === block.dataset_id && item.scope_id === evidence.scope.id,
        );
        return (
          <article className="ic-block" key={block.id}>
            <span className={`ic-status ${block.status}`}>
              {statuses[block.status]}
            </span>
            {block.title && <h3>{formatInsightCopy(block.title)}</h3>}
            <p className="ic-body">{formatInsightCopy(block.body)}</p>
            {block.kind === "visual" &&
              dataset?.id !== "investment-review" &&
              (dataset ? (
                <InsightChart dataset={dataset} />
              ) : (
                <p>当前快照没有可用的图表证据。</p>
              ))}
            <FactReferences ids={block.fact_ids} evidence={evidence} />
          </article>
        );
      })}
      {result.limitations.length > 0 && (
        <aside className="ic-limitations" aria-label="分析限制">
          {result.limitations.map((text, index) => (
            <p key={index}>{formatInsightCopy(text)}</p>
          ))}
        </aside>
      )}
    </section>
  );
}
