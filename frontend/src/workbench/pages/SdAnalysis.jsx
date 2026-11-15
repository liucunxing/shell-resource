import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { MetricHelp } from "./MetricHelp";
import {
  TableCell,
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
} from "../../components/ui/table";
import { Card } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { useEffect, useId, useState } from "react";
import {
  compareVersionGroups,
  groupSummary,
  initiativeOrganizationFacts,
  portfolioRows,
  versionFluctuation,
} from "../domain/portfolio-analytics.js";
import { submittedVersionItems } from "../domain/version-baseline.js";
import * as api from "../api.js";
import { V20OrganizationSummary } from "./V20OrganizationSummary.jsx";
import { ResourceDetailDrawer } from "./ResourceDetailDrawer";
import { configuredYtdLabel } from "../domain/dealer-history";

const amount = (value, scale = 1) =>
  value == null
    ? "—"
    : (Number(value) / scale).toLocaleString("zh-CN", {
        maximumFractionDigits: 2,
      });
const percentage = (value) => (value == null ? "—" : `${amount(value)}%`);
const difference = (value) =>
  value == null ? "—" : `${value > 0 ? "+" : ""}${amount(value)} pp`;

export function sdPresentationGroups(groups) {
  const current = groups.filter((group) => group.rows?.length);
  const sum = (key) =>
    groups.reduce((total, group) => total + (group[key] || 0), 0);
  const complete = (key) =>
    current.length && current.every((group) => group[key] != null)
      ? current.reduce((total, group) => total + group[key], 0)
      : null;
  const totals = {
    amount: sum("amount"),
    allocatedCount: sum("allocatedCount"),
    selectedCount: sum("selectedCount"),
    totalCount: sum("totalCount"),
    analyticalVol: complete("analyticalVol"),
    analyticalC3: complete("analyticalC3"),
    historicalVol: complete("historicalVol"),
    historicalC3: complete("historicalC3"),
    historicalInvestment: complete("historicalInvestment"),
    contractVolume: complete("contractVolume"),
  };
  totals.average = totals.allocatedCount
    ? totals.amount / totals.allocatedCount
    : null;
  totals.phasing =
    totals.contractVolume > 0 && totals.historicalVol != null
      ? totals.historicalVol / totals.contractVolume
      : null;
  totals.historicalYield =
    totals.historicalInvestment > 0 &&
    totals.historicalC3 > 0 &&
    current.every((group) => group.yieldAligned)
      ? totals.historicalC3 / totals.historicalInvestment
      : null;
  const comparable =
    groups.length && groups.every((group) => group.comparison?.comparable);
  const previousAmount = comparable
    ? groups.reduce(
        (total, group) => total + group.comparison.previousAmount,
        0,
      )
    : null;
  totals.comparison = {
    previousAmount,
    delta: comparable ? totals.amount - previousAmount : null,
    ...versionFluctuation(totals.amount, previousAmount, Boolean(comparable)),
  };
  const share = (value, total) =>
    value != null && total > 0 ? (value / total) * 100 : null;
  return {
    totals,
    groups: groups.map((group) => ({
      ...group,
      average: group.allocatedCount
        ? group.amount / group.allocatedCount
        : null,
      volShare: group.rows?.length
        ? share(group.analyticalVol, totals.analyticalVol)
        : null,
      c3Share: group.rows?.length
        ? share(group.analyticalC3, totals.analyticalC3)
        : null,
      historyShare: share(
        group.historicalInvestment,
        totals.historicalInvestment,
      ),
    })),
  };
}

export function sdGroupsWithComparison(
  items,
  sourceItems,
  dealers,
  groupBy,
  basis,
  period,
  masterDealers = dealers,
) {
  const sectors = new Set(items.map((item) => item.sector));
  const scopeDealers = masterDealers.filter((dealer) =>
    sectors.has(dealer.sector),
  );
  const groups = groupSummary(
    portfolioRows(items, dealers, basis, period),
    scopeDealers,
    groupBy,
    period,
    { includeMasterGroups: true },
  );
  const comparisons = compareVersionGroups(
    items,
    sourceItems,
    dealers,
    groupBy,
    { sameInitiatives: true },
  );
  const byKey = new Map(groups.map((group) => [group.key, group]));
  for (const comparison of comparisons) {
    if (!byKey.has(comparison.key))
      byKey.set(comparison.key, {
        key: comparison.key,
        amount: 0,
        selectedCount: 0,
        allocatedCount: 0,
        totalCount: scopeDealers.filter(
          (dealer) => dealer[groupBy] === comparison.key,
        ).length,
      });
    byKey.get(comparison.key).comparison = comparison;
  }
  const comparisonAvailable =
    sourceItems != null && comparisons.every((row) => row.comparable);
  for (const group of byKey.values())
    if (!group.comparison)
      group.comparison = {
        comparable: comparisonAvailable,
        previousAmount: comparisonAvailable ? 0 : null,
        currentAmount: comparisonAvailable ? 0 : null,
        delta: comparisonAvailable ? 0 : null,
        ...versionFluctuation(0, 0, comparisonAvailable),
      };
  return [...byKey.values()].sort((a, b) =>
    String(a.key).localeCompare(String(b.key), "zh", { numeric: true }),
  );
}
export function SdAnalysis({
  items: allItems,
  variant = "portfolio",
  dealers,
  showOwner = false,
  threshold = 3,
  redThreshold = 10,
  metadata = {},
  sourceVersionId = "",
  comparisonIdentity = "",
  ytdCutoffMonth = 10,
}) {
  const isEditor = variant === "editor";
  const items = showOwner
    ? allItems.filter(
        (item) => item.workflow?.submitted ?? item.allocationVisible !== false,
      )
    : allItems;
  const id = useId().replaceAll(":", "");
  const [period, setPeriod] = useState("2025"),
    [basis, setBasis] = useState("c3"),
    [groupBy, setGroupBy] = useState("sd");
  const [highlight, setHighlight] = useState("");
  const [detail, setDetail] = useState(null);
  const [source, setSource] = useState(null),
    [sourceDealers, setSourceDealers] = useState([]),
    [sourceError, setSourceError] = useState(""),
    [sourceLoading, setSourceLoading] = useState(false);
  useEffect(() => {
    let active = true;
    setSource(null);
    setSourceDealers([]);
    setSourceError("");
    setSourceLoading(false);
    if (!sourceVersionId) return;
    setSourceLoading(true);
    api
      .workspace(sourceVersionId)
      .then((workspace) => {
        if (active) {
          setSource(submittedVersionItems(workspace));
          setSourceDealers(workspace.data?.dealers || []);
        }
      })
      .catch((failure) => {
        if (active) setSourceError(failure.message);
      })
      .finally(() => {
        if (active) setSourceLoading(false);
      });
    return () => {
      active = false;
    };
  }, [sourceVersionId, comparisonIdentity]);
  const comparisonDealers = [
    ...new Map(
      [...sourceDealers, ...dealers].map((dealer) => [
        `${dealer.sector}:${dealer.id}`,
        dealer,
      ]),
    ).values(),
  ];
  const sectors = new Set(items.map((item) => item.sector));
  const scopeDealers = dealers.filter((dealer) => sectors.has(dealer.sector));
  const grouped = sdGroupsWithComparison(
    items,
    source,
    comparisonDealers,
    groupBy,
    basis,
    period,
    dealers,
  );
  const { groups, totals } = sdPresentationGroups(
    isEditor
      ? grouped.filter((group) => group.selectedCount || group.comparison?.previousAmount > 0)
      : grouped,
  );
  const facts = initiativeOrganizationFacts(
    items,
    dealers,
    basis,
    period,
    threshold,
    groupBy,
  );
  const sdKeys = groups.map((group) => group.key);
  const locate = (key) => {
    setHighlight(key);
    const element = document.getElementById(`${id}-${encodeURIComponent(key)}`);
    element?.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "center",
    });
    element?.focus({ preventScroll: true });
  };
  const matrix = items
    .map((item) => ({
      item,
      groups: groupSummary(
        portfolioRows([item], dealers, basis, period),
        scopeDealers,
        groupBy,
        period,
      ),
    }))
    .map((entry) => ({
      ...entry,
      worst: [...entry.groups]
        .filter((group) => group.gap != null)
        .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))[0],
    }))
    .sort((a, b) => Math.abs(b.worst?.gap || 0) - Math.abs(a.worst?.gap || 0));
  const aggregateFacts = groups
    .filter((group) => group.gap != null && Math.abs(group.gap) > threshold)
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
  const level = (gap) =>
    gap == null
      ? "none"
      : Math.abs(gap) > redThreshold
        ? "bad"
        : Math.abs(gap) > threshold
          ? "warn"
          : "good";
  return (
    <Card
      id="studio-structure"
      className="panel studio-section v19-sd-analysis gap-4 p-4"
    >
      <header>
        {!isEditor && <span>④</span>}
        <div>
          <h2>
            {isEditor
              ? `投入结构 · 按 ${groupBy.toUpperCase()} 汇总`
              : `按 SD/RSM 看 · 各 ${groupBy.toUpperCase()} 分得是否均衡`}
          </h2>
          <p>
            {isEditor
              ? "对照历史 Delivery Vol / C3，查看本项目名单的投入分布。"
              : "对照历史 Delivery Vol / C3，查看当前组合及各 Initiative 的投入分布。"}
          </p>
        </div>
      </header>
      <div className="studio-inline-controls">
        <Tabs value={groupBy} onValueChange={setGroupBy} aria-label="组织视角">
          <TabsList>
            <TabsTrigger value="sd">按 SD</TabsTrigger>
            <TabsTrigger value="rsm">按 RSM</TabsTrigger>
          </TabsList>
        </Tabs>
        <span>历史参考</span>
        <Tabs value={period} onValueChange={setPeriod}>
          <TabsList>
            <TabsTrigger value="2025">2025 全年</TabsTrigger>
            <TabsTrigger value="2026Ytd">{configuredYtdLabel(ytdCutoffMonth)}</TabsTrigger>
          </TabsList>
        </Tabs>
        <Tabs value={basis} onValueChange={setBasis}>
          <TabsList>
            <TabsTrigger value="vol">Vol</TabsTrigger>
            <TabsTrigger value="c3">C3</TabsTrigger>
          </TabsList>
        </Tabs>
        <MetricHelp>
              <p>
                {metadata.source || "历史数据来源"} · Actual 最新月：
                {metadata.actual?.latestMonth || "未提供"} · 历史费用最新月：
                {metadata.investment?.latestMonth || "未提供"}。Sellin
                按季度更新，实际覆盖以数据快照为准；更新频率不代表数据截止月。
              </p>
        </MetricHelp>
      </div>
      <p className="studio-table-note">
        来源版本：{sourceVersionId || "无来源版本"}
        {sourceLoading ? " · 正在读取最后已提交快照…" : ""}。较上版 = 本版投资 −
        来源版最后已提交投资（万元）； 只比较同一 Initiative
        集合，保留本版已移除组织的上版投入。
      </p>
      {sourceError && (
        <Alert variant="destructive" className="note-box warn" role="alert">
          <AlertDescription>
            来源快照读取失败：{sourceError}；较上版金额暂不可比较。
          </AlertDescription>
        </Alert>
      )}
      {!isEditor && (
        <div
          className="v19-sd-facts"
          data-level={
            [...aggregateFacts, ...facts].some(
              (fact) => level(fact.gap) === "bad",
            )
              ? "bad"
              : aggregateFacts.length || facts.length
                ? "warn"
                : "good"
          }
        >
          <section>
            <b>① 组合叠加</b>
            <div className="v20-fact-grid">
            {aggregateFacts.map((group) => (
              <Button
                key={group.key}
                variant="ghost"
                className="v19-sd-fact"
                onClick={() => locate(`summary-${group.key}`)}
              >
                <span>
                  {group.key}：投资占比 {percentage(group.amountShare)}，
                  {basis === "c3" ? "C3" : "Delivery Vol"} 占比{" "}
                  {percentage(group.metricShare)}，
                  <strong>
                    {group.gap > 0 ? "偏多" : "偏少"}{" "}
                    {amount(Math.abs(group.gap))} pp
                  </strong>
                </span>
                <small>定位 →</small>
              </Button>
            ))}
            {!aggregateFacts.length && (
              <p>
                {groups.some((group) => group.gap != null)
                  ? `各 ${groupBy.toUpperCase()} 投资占比与产出占比的差值均在 ±${threshold} pp 内。`
                  : "当前范围暂无可比较的历史产出。"}
              </p>
            )}
            </div>
          </section>
          <section>
            <b>② Initiative 明细</b>
            <div className="v20-fact-grid">
            {[...facts]
              .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
              .map((fact) => (
                <Button
                  key={`${fact.initiativeId}-${fact.key}`}
                  variant="ghost"
                  className="v19-sd-fact"
                  onClick={() =>
                    locate(`matrix-${fact.initiativeId}-${fact.key}`)
                  }
                >
                  <span>
                    <strong>{fact.initiativeName}</strong>
                    {showOwner && ` · Owner：${fact.owner}`}· {fact.key}
                    ：投资占比 {percentage(fact.amountShare)}，
                    {basis === "c3" ? "C3" : "Delivery Vol"} 占比{" "}
                    {percentage(fact.metricShare)}，
                    <strong>
                      {fact.gap > 0 ? "偏多" : "偏少"}{" "}
                      {amount(Math.abs(fact.gap))} pp
                    </strong>
                  </span>
                  <small>定位 →</small>
                </Button>
              ))}
            {!facts.length && (
              <p>
                {matrix.some((entry) => entry.worst)
                  ? `各 Initiative 在已覆盖 ${groupBy.toUpperCase()} 内的偏离均在 ±${threshold} pp 内。`
                  : "当前范围暂无可比较的项目分配。"}
              </p>
            )}
            </div>
          </section>
          <p className="v19-sd-fact-rule">
            {period === "2025" ? "2025 全年" : configuredYtdLabel(ytdCutoffMonth)} ·{" "}
            {basis === "c3" ? "C3" : "Delivery Vol"}；差值 = 投资占比 −
            产出占比。按已勾选名单计算，逐项列出超过 ±{threshold} pp
            的偏离；超过 ±{redThreshold} pp 优先关注。
          </p>
        </div>
      )}
      {!isEditor && (
        <h3>① 各 {groupBy.toUpperCase()} 叠加后 · 投资金额占比 vs 产出占比</h3>
      )}
      <V20OrganizationSummary
        groups={groups}
        countScope={isEditor ? "selected" : "all"}
        totals={totals}
        groupBy={groupBy}
        period={period}
        ytdCutoffMonth={ytdCutoffMonth}
        basis={basis}
        threshold={threshold}
        redThreshold={redThreshold}
        sourceVersionId={sourceVersionId}
        highlight={highlight}
        rowId={(key) => id + "-" + encodeURIComponent("summary-" + key)}
        onOpen={(key) =>
          setDetail({
            type: "organization",
            groupBy,
            groupKey: key,
            period,
            basis,
          })
        }
      />
      {!isEditor && !!items.length && (
        <>
          <h3>② 各 Initiative 在 {groupBy.toUpperCase()} 间的分配</h3>
          <div className="table-scroll">
            <Table
              containerClassName="overflow-visible"
              className="v19-sd-matrix"
            >
              <TableHeader>
                <TableRow>
                  <TableHead>Initiative</TableHead>
                  {showOwner && <TableHead>Owner</TableHead>}
                  {showOwner && <TableHead>资源大类</TableHead>}
                  <TableHead className="num">已分配（万元）</TableHead>
                  {sdKeys.map((key) => (
                    <TableHead key={key} className="num">
                      {key}
                    </TableHead>
                  ))}
                  <TableHead className="num">最大偏离</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="v19-sd-reference">
                  <TableHead colSpan={showOwner ? 3 : 1}>
                    参照：{showOwner ? "本部门" : "本人"}叠加
                  </TableHead>
                  <TableCell className="num">
                    {amount(totals.amount, 10000)}
                  </TableCell>
                  {groups.map((group) => (
                    <TableCell key={group.key} className="num">
                      <b>{percentage(group.amountShare)}</b>
                      <small>
                        {basis === "c3" ? "C3" : "Vol"}{" "}
                        {percentage(group.metricShare)}
                      </small>
                    </TableCell>
                  ))}
                  <TableCell />
                </TableRow>
                {matrix.map(({ item, groups: itemGroups, worst }) => (
                  <TableRow key={item.id}>
                    <TableHead>
                      <Button
                        variant="link"
                        onClick={() =>
                          setDetail({
                            type: "initiative",
                            initiativeId: item.id,
                            period,
                            basis,
                          })
                        }
                      >
                        {item.name}
                      </Button>
                      {!showOwner && <small>{item.resourceType}</small>}
                    </TableHead>
                    {showOwner && (
                      <TableCell>
                        {item.ownerName ||
                          item.ownerLabel ||
                          item.ownerId ||
                          "—"}
                      </TableCell>
                    )}
                    {showOwner && <TableCell>{item.resourceType}</TableCell>}
                    <TableCell className="num">
                      {amount(
                        itemGroups.reduce(
                          (sum, group) => sum + group.amount,
                          0,
                        ),
                        10000,
                      )}
                    </TableCell>
                    {sdKeys.map((key) => {
                      const group = itemGroups.find(
                          (entry) => entry.key === key,
                        ),
                        target = `matrix-${item.id}-${key}`;
                      return (
                        <TableCell
                          key={key}
                          id={`${id}-${encodeURIComponent(target)}`}
                          tabIndex="-1"
                          className={`v19-sd-heat ${highlight === target ? "v19-highlight" : ""}`}
                          data-level={level(group?.gap)}
                        >
                          {group ? (
                            <>
                              <strong>{percentage(group.amountShare)}</strong>
                              <small>
                                {basis === "c3" ? "C3" : "Vol"}{" "}
                                {percentage(group.metricShare)} ·{" "}
                                {difference(group.gap)}
                              </small>
                            </>
                          ) : (
                            <span
                              title={`该项目未覆盖此 ${groupBy.toUpperCase()}，不参与偏离判断`}
                            >
                              —
                            </span>
                          )}
                        </TableCell>
                      );
                    })}
                    <TableCell className="num" data-level={level(worst?.gap)}>
                      {worst ? (
                        <>
                          <b>{difference(worst.gap)}</b>
                          <small>{worst.key}</small>
                        </>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="studio-table-note">
            每格 = 该 Initiative 投到该 {groupBy.toUpperCase()}{" "}
            的投资金额占其已分配的比例；下方为该
            {groupBy.toUpperCase()} 在该 Initiative
            名单内的产出占比及差值。未覆盖的组织
            不参与偏离判断，项目按最大绝对偏离排序。
          </p>
        </>
      )}
      {detail && (
        <ResourceDetailDrawer
          detail={detail}
          items={items}
          dealers={dealers}
          sourceItems={source}
          ytdCutoffMonth={ytdCutoffMonth}
          onClose={() => setDetail(null)}
        />
      )}
    </Card>
  );
}
