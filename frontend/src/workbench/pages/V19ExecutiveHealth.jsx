import { useLegendColors } from "../LegendColors";
import { MetricHelp } from "./MetricHelp";
import { useState } from "react";
import { Card } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../../components/ui/table";
import { WorkflowDialog } from "./WorkflowDialog.jsx";
import { ResourceDetailDrawer } from "./ResourceDetailDrawer";
import { AnalysisConclusion, AnalysisValue } from "./AnalysisConclusion";
import {
  CumulativeChart,
  HistoryControls,
  orderedResourceTypes,
} from "./V19PortfolioVisuals.jsx";
import { concentration, portfolioRows } from "../domain/portfolio-analytics.js";

const number = (value) =>
  Number(value || 0).toLocaleString("zh-CN", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  });
const percent = (value) => (value == null ? "—" : `${number(value)}%`);
const gap = (value) =>
  value == null ? "—" : `${value > 0 ? "+" : ""}${number(value)}pp`;
const tops = [20, 50, 80];
const level = (value, thresholds) =>
  value == null
    ? "none"
    : value > (thresholds.concentrationRed ?? 10)
      ? "bad"
      : value > (thresholds.concentrationYellow ?? 5)
        ? "warn"
        : "good";
const worstOf = (rows) =>
  tops
    .map((top) => ({ ...concentration(rows, top), topPercent: top }))
    .filter((value) => value.count)
    .sort((a, b) => b.gap - a.gap)[0];

function TopRows({ rows, basis, thresholds, onSelect }) {
  return (
    <Table className="v19-exec-top-table">
      <TableHeader>
        <TableRow>
          <TableHead>经销商（家）</TableHead>
          <TableHead>投资金额占比（%）</TableHead>
          <TableHead>{basis === "c3" ? "C3" : "Vol"} 占比（%）</TableHead>
          <TableHead>差值（pp）</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tops.map((top) => {
          const result = concentration(rows, top);
          return (
            <TableRow key={top}>
              <TableCell>
                <Button variant="link" onClick={() => onSelect(top)}>
                  Top {top}%
                </Button>
                <small>{result?.n || 0}</small>
              </TableCell>
              <TableCell sortValue={result?.amountShare}>
                {result?.amountShare == null ? "—" : number(result.amountShare)}
              </TableCell>
              <TableCell sortValue={result?.metricShare}>
                {result?.metricShare == null ? "—" : number(result.metricShare)}
              </TableCell>
              <TableCell
                data-level={level(result?.gap, thresholds)}
                sortValue={result?.gap}
              >
                {result?.gap == null ? "—" : `${result.gap > 0 ? "+" : ""}${number(result.gap)}`}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export function executiveConcentrationGroups(items, dealers, basis, period) {
  return orderedResourceTypes(items.map((item) => item.resourceType)).map(
    (type) => {
      const all = items.filter((item) => item.resourceType === type);
      const included = all.filter(
        (item) => item.workflow?.confirmed ?? item.allocationVisible !== false,
      );
      const rows = portfolioRows(included, dealers, basis, period);
      const initiatives = included
        .map((item) => ({
          ...item,
          rows: portfolioRows([item], dealers, basis, period),
        }))
        .map((item) => ({ ...item, worst: worstOf(item.rows) }))
        .sort((a, b) => (b.worst?.gap || 0) - (a.worst?.gap || 0));
      return {
        type,
        all,
        included,
        rows,
        initiatives,
        worst: worstOf(rows),
        amount: rows.reduce((total, row) => total + row.amount, 0),
      };
    },
  );
}

export function V19ExecutiveHealth({
  items,
  dealers,
  thresholds = {},
  ytdCutoffMonth = 10,
  budgetReasons = [],
  filters = {},
}) {
  const { resourceColor } = useLegendColors();
  const [period, setPeriod] = useState("2025"),
    [basis, setBasis] = useState("c3"),
    [detail, setDetail] = useState(null);
  const [drill, setDrill] = useState(null);
  const groups = executiveConcentrationGroups(items, dealers, basis, period);
  const included = groups.flatMap((group) => group.included),
    rows = portfolioRows(included, dealers, basis, period);
  const hasComparableTotals = concentration(rows, 20) != null;
  const flags = groups
    .filter(
      (group) => group.worst && level(group.worst.gap, thresholds) !== "good",
    )
    .sort((a, b) => b.worst.gap - a.worst.gap);
  const hidden = groups.filter(
    (group) =>
      group.worst &&
      level(group.worst.gap, thresholds) === "good" &&
      group.initiatives.some(
        (item) => item.worst && level(item.worst.gap, thresholds) !== "good",
      ),
  );
  const label = basis === "c3" ? "C3" : "Delivery Vol";
  const openTop = (scope, name, top, scopeItems = included) => {
    const result = concentration(scope, top);
    if (result)
      setDrill({
        type: "cohort",
        title: name + " · Top " + top + "% 集中度明细",
        scopeDealerKeys: result.top.map((row) => row.key),
        period,
        basis,
        topPercent: top,
        cohortDimensions: true,
        cohortFilteredDimensions: [
          "resourceType",
          "sector",
          "department",
        ].filter((key) => filters[key] && filters[key] !== "all"),
        scopeItems,
      });
  };
  const openCategory = (group) =>
    setDetail({
      kind: "category",
      name: `${group.type} · Initiative 集中度`,
      resourceType: group.type,
    });
  return (
    <Card className="v19-board-section v19-executive-health">
      <div className="v19-section-heading">
        <div>
          <h2>
            集中度 · 各资源大类的投资是否集中在少数经销商{" "}
            <MetricHelp>
              经销商按投资从高到低排序，比较Top
              20%、50%、80%的投资累计占比与历史产出累计占比；各资源大类按各自名单计算，缺少有效历史产出者不参与比较。
            </MetricHelp>
          </h2>
        </div>
      </div>
      <div className="v19-board-body">
        <HistoryControls
          {...{ period, setPeriod, basis, setBasis, ytdCutoffMonth }}
        />
        <div className="v19-exec-concentration-overview">
          <section>
            <h3>全部资源大类叠加 · 累计集中度</h3>
            {hasComparableTotals ? (
              <>
                <CumulativeChart
                  rows={rows}
                  basis={basis}
                  onSelect={(top) => openTop(rows, "全部资源大类", top)}
                />
                <div className="v19-chart-legend">
                  <span>● 投资金额</span>
                  <span>○ {label}</span>
                  <span>经销商按投入从高到低排序</span>
                </div>
                <TopRows
                  rows={rows}
                  basis={basis}
                  thresholds={thresholds}
                  onSelect={(top) => openTop(rows, "全部资源大类", top)}
                />
              </>
            ) : (
              <p className="empty">当前范围暂无可比较的已确认数据。</p>
            )}
          </section>
          <AnalysisConclusion
            title="集中度分析结论"
            className="v19-exec-conclusions"
          >
            <p>
              {!hasComparableTotals ? (
                "当前投资或历史产出合计不足，暂无法计算集中度。"
              ) : flags.length ? (
                <>
                  <AnalysisValue tone="alert">{flags.length} 个</AnalysisValue>
                  资源大类在至少一个 Top
                  档位的投资占比高于产出占比，超过关注阈值。
                </>
              ) : (
                "可比较的资源大类在 Top 20%／50%／80% 的投资占比与产出占比差值均未超过关注阈值。"
              )}
            </p>
            {flags.map((group) => (
              <Button
                key={group.type}
                variant="ghost"
                className="v19-exec-conclusion-row"
                onClick={() => openCategory(group)}
              >
                <i style={{ background: resourceColor(group.type) }} />
                <b>{group.type}</b>
                <span>
                  投资金额最多的 Top {group.worst.topPercent}% 经销商（
                  {group.worst.n} 家）：
                  <span className="analysis-phrase">
                    获得{" "}
                    <AnalysisValue tone="investment">
                      {percent(group.worst.amountShare)}
                    </AnalysisValue>{" "}
                    的投资，
                  </span>{" "}
                  <span className="analysis-phrase">
                    贡献{" "}
                    <AnalysisValue tone="output">
                      {percent(group.worst.metricShare)}
                    </AnalysisValue>{" "}
                    的{label}。
                  </span>{" "}
                  <span className="analysis-phrase">
                    投资占比高出{" "}
                    <AnalysisValue tone="alert">
                      {gap(group.worst.gap)}
                    </AnalysisValue>
                    。
                  </span>
                </span>
              </Button>
            ))}
            {hidden.map((group) => (
              <Button
                key={group.type}
                variant="ghost"
                className="v19-exec-conclusion-row"
                onClick={() => openCategory(group)}
              >
                <i style={{ background: resourceColor(group.type) }} />
                <b>{group.type}</b>
                <span>
                  大类叠加未超过关注阈值，其中{" "}
                  <AnalysisValue tone="alert">
                    {
                      group.initiatives.filter(
                        (item) =>
                          item.worst &&
                          level(item.worst.gap, thresholds) !== "good",
                      ).length
                    }{" "}
                    个
                  </AnalysisValue>{" "}
                  Initiative 单独计算时超过阈值。查看明细 →
                </span>
              </Button>
            ))}
            <p className="studio-table-note">
              {period === "2025" ? "2025 全年" : "2026 YTD"} · {label}
              ；每个资源大类按各自有历史产出的名单计算。差值 &gt;
              {thresholds.concentrationYellow ?? 5}pp 建议复核，&gt;
              {thresholds.concentrationRed ?? 10}pp 优先关注。点击资源大类查看
              Initiative。
            </p>
          </AnalysisConclusion>
        </div>
        <div className="v19-exec-category-grid">
          {groups.map((group) => {
            const attention = group.initiatives.filter(
                (item) =>
                  item.worst && level(item.worst.gap, thresholds) !== "good",
              ),
              severity = level(group.worst?.gap, thresholds);
            return (
              <Card
                key={group.type}
                className="v19-exec-category-card"
                style={{ borderTopColor: resourceColor(group.type) }}
              >
                <div className="v19-exec-category-heading">
                  <div>
                    <Button variant="link" onClick={() => openCategory(group)}>
                      <i
                        className="v19-color-dot"
                        style={{ background: resourceColor(group.type) }}
                      />
                      {group.type}
                    </Button>
                    <small>
                      已分配 {number(group.amount / 10000)} 万元 ·{" "}
                      {group.included.length}/{group.all.length} 个 Initiative
                      已确认
                    </small>
                  </div>
                  <Badge
                    variant={severity === "bad" ? "destructive" : "secondary"}
                  >
                    {!group.worst
                      ? "暂无可比较数据"
                      : severity === "good"
                        ? attention.length
                          ? `整体匹配 · ${attention.length} 个 Initiative 集中`
                          : "与产出匹配"
                        : `${severity === "bad" ? "优先关注" : "建议复核"} · Top${group.worst.topPercent}% ${gap(group.worst.gap)}`}
                  </Badge>
                </div>
                {group.worst ? (
                  <div className="v19-exec-category-body">
                    <CumulativeChart
                      rows={group.rows}
                      basis={basis}
                      onSelect={(top) =>
                        openTop(group.rows, group.type, top, group.included)
                      }
                    />
                    <TopRows
                      rows={group.rows}
                      basis={basis}
                      thresholds={thresholds}
                      onSelect={(top) =>
                        openTop(group.rows, group.type, top, group.included)
                      }
                    />
                  </div>
                ) : (
                  <p className="empty">暂无可比较的已确认数据</p>
                )}
                <div className="v19-exec-category-footer">
                  <span>
                    {group.initiatives[0]?.worst ? (
                      group.initiatives[0].worst.gap <= 0 ? (
                        "各 Initiative 投入均不比产出集中"
                      ) : (
                        <>
                          最集中：<b>{group.initiatives[0].name}</b> · Top
                          {group.initiatives[0].worst.topPercent}%{" "}
                          {gap(group.initiatives[0].worst.gap)}
                        </>
                      )
                    ) : (
                      "暂无已确认数据"
                    )}
                  </span>
                  <Button variant="link" onClick={() => openCategory(group)}>
                    查看 {group.included.length} 个 Initiative →
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
        <p className="studio-table-note">
          差值 &gt;{thresholds.concentrationYellow ?? 5}pp 建议复核，&gt;
          {thresholds.concentrationRed ?? 10}pp 优先关注。Top 80%
          的差值天然较小；无历史经销商不参与比较。
        </p>
      </div>
      {detail && (
        <WorkflowDialog
          wide
          title={detail.name}
          onClose={() => setDetail(null)}
        >
          {detail.kind === "category" ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Initiative</TableHead>
                  <TableHead>Owner</TableHead>
                  {tops.map((top) => (
                    <TableHead key={top}>
                      Top {top}% · 投资 / {label}（%）
                    </TableHead>
                  ))}
                  <TableHead>最大集中度差值（pp）</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(
                  groups.find((group) => group.type === detail.resourceType)
                    ?.initiatives || []
                ).map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Button
                        variant="link"
                        onClick={() =>
                          setDrill({
                            type: "initiative",
                            initiativeId: item.id,
                            period,
                            basis,
                          })
                        }
                      >
                        {item.name}
                      </Button>
                    </TableCell>
                    <TableCell>
                      {item.ownerName || item.ownerId || "—"}
                    </TableCell>
                    {tops.map((top) => {
                      const result = concentration(item.rows, top);
                      return (
                        <TableCell key={top} sortValue={result?.amountShare}>
                          <Button
                            variant="link"
                            onClick={() =>
                              openTop(
                                item.rows,
                                item.name,
                                top,
                                included.filter(
                                  (source) =>
                                    String(source.id) === String(item.id),
                                ),
                              )
                            }
                          >
                            {result?.amountShare == null ? "—" : number(result.amountShare)} /{" "}
                            {result?.metricShare == null ? "—" : number(result.metricShare)}
                          </Button>
                        </TableCell>
                      );
                    })}
                    <TableCell sortValue={item.worst?.gap}>
                      {item.worst?.gap == null ? "—" : `${item.worst.gap > 0 ? "+" : ""}${number(item.worst.gap)}`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>经销商名称</TableHead>
                  <TableHead>经销商编码</TableHead>
                  <TableHead>SD</TableHead>
                  <TableHead>投资金额（万元）</TableHead>
                  <TableHead>{label}</TableHead>
                  <TableHead>Initiative</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.result?.top.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>{row.name}</TableCell>
                    <TableCell>{row.code || "—"}</TableCell>
                    <TableCell>{row.sd}</TableCell>
                    <TableCell sortValue={row.amount / 10000}>
                      {number(row.amount / 10000)}
                    </TableCell>
                    <TableCell sortValue={row.metric}>
                      {number(row.metric)}
                    </TableCell>
                    <TableCell>{[...row.initiatives].join("、")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </WorkflowDialog>
      )}
      {drill && (
        <ResourceDetailDrawer
          detail={drill}
          items={drill.scopeItems || included}
          dealers={dealers}
          ytdCutoffMonth={ytdCutoffMonth}
          budgetReasons={budgetReasons}
          onClose={() => setDrill(null)}
        />
      )}
    </Card>
  );
}
