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
  return `${value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}${unit === "CNY" ? " 元" : unit === "multiple" ? " 倍" : unit === "count" ? "" : unit ? ` ${unit}` : ""}`;
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
        {dataset.y.unit === "CNY" ? "元" : dataset.y.unit}）
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
          {formatEvidence(minX)}
        </text>
        <text x="338" y="258" textAnchor="end">
          {formatEvidence(maxX)}
        </text>
        <text x="36" y="20">
          {formatEvidence(maxY)}
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
        {dataset.period} · {dataset.note}
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
            {fact.label}：{formatEvidence(fact.value, fact.unit)}
          </strong>
          <br />
          {fact.period} · {fact.source}
          {fact.note && ` · ${fact.note}`}
        </p>
      ))}
    </details>
  );
}
export function InsightCapabilityResult({
  result,
  evidence,
}: {
  result: CapabilityResult;
  evidence: Evidence;
}) {
  return (
    <section className="ic-result">
      <h3>{result.headline}</h3>
      <p className="ic-body">{result.summary}</p>
      {evidence.provenance.kind === "synthetic" && (
        <p className="note-box">合成数据：{evidence.provenance.description}</p>
      )}
      <ul className="ic-checks" aria-label="六维检查摘要">
        {result.checks.map((check) => (
          <li key={check.dimension_id}>
            <div>
              <strong>{dimensions[check.dimension_id]}</strong>
              <span className={`ic-status ${check.status}`}>
                {statuses[check.status]}
              </span>
            </div>
            <p>{check.summary}</p>
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
            {block.title && <h3>{block.title}</h3>}
            <p className="ic-body">{block.body}</p>
            {block.kind === "visual" &&
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
            <p key={index}>{text}</p>
          ))}
        </aside>
      )}
    </section>
  );
}
