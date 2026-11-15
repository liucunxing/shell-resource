import {
  useLegendColors,
  DEFAULT_RESOURCE_COLORS,
  resolveInitiativeColor,
} from "../LegendColors";
import {
  analyticalOutput,
  rankedConcentrationRows,
} from "../domain/portfolio-analytics.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export const RESOURCE_DETAIL_COLORS = DEFAULT_RESOURCE_COLORS;
export const detailInitiativeColor = resolveInitiativeColor;

export function ResourceMixDonut({
  parts,
  title,
  center,
  unit,
}: {
  parts: { type: string; amount: number }[];
  title: string;
  center: string;
  unit: string;
}) {
  const { resourceColor } = useLegendColors();
  const values = parts.filter((part) => part.amount > 0);
  const total = values.reduce((sum, part) => sum + part.amount, 0);
  let offset = 0;
  return (
    <figure className="resource-detail-donut">
      <figcaption>{title}</figcaption>
      <svg
        viewBox="0 0 132 132"
        width="132"
        height="132"
        role="img"
        aria-label={`${title}：${center} ${unit}`}
      >
        <circle
          cx="66"
          cy="66"
          r="51"
          fill="none"
          stroke="#edf1f4"
          strokeWidth="20"
        />
        {values.map((part) => {
          const length = (part.amount / total) * 100;
          const start = offset;
          offset += length;
          return (
            <circle
              key={part.type}
              cx="66"
              cy="66"
              r="51"
              fill="none"
              stroke={resourceColor(part.type)}
              strokeWidth="20"
              pathLength="100"
              strokeDasharray={`${length} ${100 - length}`}
              strokeDashoffset={-start}
              transform="rotate(-90 66 66)"
            >
              <title>{`${part.type}：${((part.amount / total) * 100).toFixed(1)}%`}</title>
            </circle>
          );
        })}
        <text
          x="66"
          y="64"
          textAnchor="middle"
          className="resource-donut-value"
        >
          {center}
        </text>
        <text x="66" y="82" textAnchor="middle" className="resource-donut-unit">
          {unit}
        </text>
      </svg>
      {!total && <p className="resource-detail-note">暂无正向投资构成</p>}
    </figure>
  );
}

type ConcentrationRow = {
  amount: number;
  metric: number | null;
  hasHistory?: boolean;
  code?: string;
  id?: string;
};
export function detailCurvePoints(rows: ConcentrationRow[]) {
  const ranked: ConcentrationRow[] = rankedConcentrationRows(rows);
  const total = ranked.reduce((sum, row) => sum + row.amount, 0);
  const output = ranked.reduce(
    (sum, row) => sum + analyticalOutput(row.metric),
    0,
  );
  if (!ranked.length || total <= 0 || output <= 0) return null;
  let amount = 0,
    metric = 0;
  return [
    { x: 0, amount: 0, metric: 0 },
    ...ranked.map((row, index) => {
      amount += row.amount;
      metric += analyticalOutput(row.metric);
      return {
        x: ((index + 1) / ranked.length) * 100,
        amount: (amount / total) * 100,
        metric: (metric / output) * 100,
      };
    }),
  ];
}
export function DetailConcentrationCurve({
  rows,
  basis,
}: {
  rows: ConcentrationRow[];
  basis: "vol" | "c3";
}) {
  const points = detailCurvePoints(rows);
  const metricLabel = basis === "vol" ? "Delivery Vol" : "C3";
  if (!points)
    return (
      <p className="resource-detail-note">
        名单内缺少可比较的历史产出或投资，无法计算集中度。
      </p>
    );
  const X = (value: number) => 42 + value * 3.84;
  const Y = (value: number) => 216 - value * 2.04;
  const path = (key: "amount" | "metric") =>
    points.map((p) => `${X(p.x)},${Y(p[key])}`).join(" ");
  return (
    <figure className="resource-detail-curve">
      <svg
        viewBox="0 0 440 250"
        role="img"
        aria-label={`累计集中度曲线：投资金额与${metricLabel}累计占比`}
      >
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1="42" x2="426" y1={Y(v)} y2={Y(v)} stroke="#e3e8ec" />
            <text x="36" y={Y(v) + 4} textAnchor="end">
              {v}%
            </text>
          </g>
        ))}
        {[0, 20, 50, 80, 100].map((v) => (
          <text key={v} x={X(v)} y="232" textAnchor="middle">
            {v}%
          </text>
        ))}
        <polygon
          points={`${path("amount")} ${[...points]
            .reverse()
            .map((p) => `${X(p.x)},${Y(p.metric)}`)
            .join(" ")}`}
          fill="rgba(251,206,7,.18)"
        />
        <line
          x1={X(0)}
          y1={Y(0)}
          x2={X(100)}
          y2={Y(100)}
          stroke="#99a6af"
          strokeDasharray="4 4"
        />
        <polyline
          points={path("metric")}
          fill="none"
          stroke="#595959"
          strokeWidth="2.6"
        />
        <polyline
          points={path("amount")}
          fill="none"
          stroke="#E0A800"
          strokeWidth="2.6"
        />
        {[20, 50, 80].map((top) => {
          const p =
            points[Math.max(1, Math.round(((points.length - 1) * top) / 100))];
          return (
            <g key={top}>
              <line
                x1={X(p.x)}
                x2={X(p.x)}
                y1={Y(0)}
                y2={Math.min(Y(p.metric), Y(p.amount))}
                stroke="#ccd4d8"
                strokeDasharray="3 3"
              />
              <circle
                cx={X(p.x)}
                cy={Y(p.metric)}
                r="4"
                fill="white"
                stroke="#595959"
                strokeWidth="2"
              />
              <circle
                cx={X(p.x)}
                cy={Y(p.amount)}
                r="4"
                fill="#FBCE07"
                stroke="#8A6A00"
              />
              <title>{`Top ${top}%：投资 ${p.amount.toFixed(1)}% / ${metricLabel} ${p.metric.toFixed(1)}%`}</title>
            </g>
          );
        })}
        <text x="234" y="248" textAnchor="middle">
          经销商（按投入从高到低）累计占比 →
        </text>
      </svg>
      <figcaption>
        <span>
          <i style={{ background: "#E0A800" }} />
          投资金额累计占比
        </span>
        <span>
          <i style={{ background: "#595959" }} />
          {metricLabel} 累计占比
        </span>
        <span>
          <i className="average" />
          平均分配
        </span>
      </figcaption>
    </figure>
  );
}

export function InitiativeContributionBar({
  sources,
  maxAmount,
}: {
  sources: { id: string; key?: string; name: string; amount: number }[];
  maxAmount: number;
}) {
  const { initiativeColor: detailInitiativeColor } = useLegendColors();
  return (
    <div
      className="resource-detail-contribution"
      aria-label="各 Initiative 投入构成（统一金额刻度）"
    >
      {sources
        .filter((source) => source.amount > 0)
        .map((source) => (
          <span
            key={source.id}
            style={{
              width: `${maxAmount > 0 ? (source.amount / maxAmount) * 100 : 0}%`,
              background: detailInitiativeColor(source),
            }}
          >
            <title>{`${source.name}：${(source.amount / 10000).toFixed(2)} 万元`}</title>
          </span>
        ))}
    </div>
  );
}

export function CohortContributionBar({
  parts,
  maxAmount,
  dimensionLabel,
}: {
  parts: { id: string; name: string; amount: number; color: string }[];
  maxAmount: number;
  dimensionLabel: string;
}) {
  const total = parts.reduce((sum, part) => sum + part.amount, 0);
  return (
    <TooltipProvider>
      <div
        className="resource-detail-contribution resource-cohort-contribution"
        aria-label={`按${dimensionLabel}的投入构成（统一金额刻度）`}
      >
        {parts
          .filter((part) => part.amount > 0)
          .map((part) => {
            const description = `${part.name}：${(part.amount / 10000).toLocaleString("zh-CN", { maximumFractionDigits: 2 })} 万元，占该经销商投资 ${total > 0 ? ((part.amount / total) * 100).toFixed(1) : "—"}%`;
            return (
              <Tooltip key={part.id}>
                <TooltipTrigger asChild>
                  <span
                    tabIndex={0}
                    aria-label={description}
                    style={{
                      width: `${maxAmount > 0 ? (part.amount / maxAmount) * 100 : 0}%`,
                      background: part.color,
                    }}
                  />
                </TooltipTrigger>
                <TooltipContent className="z-[300]">
                  {description}
                </TooltipContent>
              </Tooltip>
            );
          })}
      </div>
    </TooltipProvider>
  );
}
