import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { Alert, AlertDescription } from "../../components/ui/alert";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "../../components/ui/accordion";
import {
  TableCell,
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableFooter,
} from "../../components/ui/table";
import { Badge } from "../../components/ui/badge";
import { Card } from "../../components/ui/card";
import { Label } from "../../components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "../../components/ui/native-select";
import { Button } from "../../components/ui/button";
import { useEffect, useId, useState } from "react";
import {
  compareVersionGroups,
  groupSummary,
  initiativeSdFacts,
  portfolioRows,
  versionFluctuation,
} from "../domain/portfolio-analytics.js";
import { submittedVersionItems } from "../domain/version-baseline.js";
import * as api from "../api.js";

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
    totals.historicalC3 != null &&
    current.every(
      (group) =>
        group.historicalYield != null || group.historicalInvestment === 0,
    )
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
      volShare: share(group.historicalVol, totals.historicalVol),
      c3Share: share(group.historicalC3, totals.historicalC3),
      historyShare: share(
        group.historicalInvestment,
        totals.historicalInvestment,
      ),
    })),
  };
}

function ShareComparison({ investment, output, basis }) {
  return (
    <div className="v19-sd-comparison-bars">
      <span>
        <i style={{ width: `${investment || 0}%`, background: "#E0A800" }} />
        投入 {percentage(investment)}
      </span>
      <span>
        <i style={{ width: `${output || 0}%`, background: "#595959" }} />
        {basis === "c3" ? "C3" : "Vol"} {percentage(output)}
      </span>
    </div>
  );
}

function HistoryCells({ group }) {
  return (
    <>
      <TableCell className="num v19-sd-actual">
        {amount(group.contractVolume, 1000)}
      </TableCell>
      <TableCell className="num v19-sd-actual">
        {amount(group.historicalVol, 1000)}
      </TableCell>
      <TableCell className="num v19-sd-actual">
        {amount(group.historicalC3, 1000)}
      </TableCell>
      <TableCell className="num v19-sd-actual">
        {percentage(group.phasing == null ? null : group.phasing * 100)}
      </TableCell>
      <TableCell className="num v19-sd-actual">
        {percentage(group.volShare)}
      </TableCell>
      <TableCell className="num v19-sd-actual">
        {percentage(group.c3Share)}
      </TableCell>
      <TableCell className="num v19-sd-ppp">待配置</TableCell>
      <TableCell className="num v19-sd-history">
        {amount(group.historicalInvestment, 1000)}
      </TableCell>
      <TableCell className="num v19-sd-history">
        {group.historicalYield == null
          ? "—"
          : `${amount(group.historicalYield)}x`}
      </TableCell>
      <TableCell className="num v19-sd-history">
        {percentage(group.historyShare)}
      </TableCell>
    </>
  );
}
export function SdComparisonCells({ comparison, sourceVersionId }) {
  return (
    <>
      <TableCell className="num">
        {amount(comparison?.previousAmount)}
      </TableCell>
      <TableCell className="num">{amount(comparison?.delta)}</TableCell>
      <TableCell className="num">
        {sourceVersionId ? comparison?.changeLabel || "不可比较" : "无来源版本"}
      </TableCell>
    </>
  );
}
export function sdGroupsWithComparison(
  items,
  sourceItems,
  dealers,
  groupBy,
  basis,
  period,
) {
  const sectors = new Set(items.map((item) => item.sector));
  const scopeDealers = dealers.filter((dealer) => sectors.has(dealer.sector));
  const groups = groupSummary(
    portfolioRows(items, dealers, basis, period),
    scopeDealers,
    groupBy,
    period,
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
  return [...byKey.values()];
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
}) {
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
  const { groups, totals } = sdPresentationGroups(
    sdGroupsWithComparison(
      items,
      source,
      comparisonDealers,
      groupBy,
      basis,
      period,
    ),
  );
  const facts =
    groupBy === "sd"
      ? initiativeSdFacts(items, dealers, basis, period, threshold)
      : [];
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
        "sd",
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
        {variant !== "editor" && <span>④</span>}
        <div>
          <h2>
            {variant === "editor"
              ? `投入结构 · 按 ${groupBy.toUpperCase()} 汇总`
              : "各 SD 分得是否均衡，与 Delivery Vol / C3 是否匹配"}
          </h2>
          <p>查看各 SD 的投入占比与项目构成</p>
        </div>
      </header>
      <div className="studio-inline-controls">
        {variant === "editor" ? (
          <Tabs value={groupBy} onValueChange={setGroupBy}>
            <TabsList>
              <TabsTrigger value="sd">按 SD</TabsTrigger>
              <TabsTrigger value="rsm">按 RSM</TabsTrigger>
            </TabsList>
          </Tabs>
        ) : (
          <Label>
            组织维度
            <NativeSelect
              value={groupBy}
              onChange={(event) => setGroupBy(event.target.value)}
            >
              <NativeSelectOption value="sd">SD</NativeSelectOption>
              <NativeSelectOption value="rsm">RSM</NativeSelectOption>
            </NativeSelect>
          </Label>
        )}
        <span>历史参考</span>
        <Tabs value={period} onValueChange={setPeriod}>
          <TabsList>
            <TabsTrigger value="2025">2025 全年</TabsTrigger>
            <TabsTrigger value="2026Ytd">2026 YTD</TabsTrigger>
          </TabsList>
        </Tabs>
        <Tabs value={basis} onValueChange={setBasis}>
          <TabsList>
            <TabsTrigger value="vol">Vol</TabsTrigger>
            <TabsTrigger value="c3">C3</TabsTrigger>
          </TabsList>
        </Tabs>
        <Accordion type="single" collapsible className="v19-method">
          <AccordionItem value="content">
            <AccordionTrigger>ⓘ 数据口径</AccordionTrigger>
            <AccordionContent
              forceMount
              className="[[data-state=closed]_&]:hidden"
            >
              <p>
                {metadata.source || "历史数据来源"} · Actual 最新月：
                {metadata.actual?.latestMonth || "未提供"} · 历史费用最新月：
                {metadata.investment?.latestMonth || "未提供"}。合同量、PPP
                缺少来源时显示缺失；月份未知时不计算 YTD Yield。
              </p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
      <p className="studio-table-note">
        来源版本：{sourceVersionId || "无来源版本"}
        {sourceLoading ? " · 正在读取最后已提交快照…" : ""}。波动率 =（本版投资
        − 来源版最后已提交投资）÷ 来源版投资；同一 Initiative 集合比较，退出 SD
        / RSM 保留 0 与 −100%。
      </p>
      {sourceError && (
        <Alert variant="destructive" className="note-box warn" role="alert">
          <AlertDescription>
            来源快照读取失败：{sourceError}；波动率暂不可比较。
          </AlertDescription>
        </Alert>
      )}
      {variant !== "editor" && (
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
            <b>① 叠加后 {groupBy.toUpperCase()} 分配</b>
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
                <small>定位到① →</small>
              </Button>
            ))}
            {!aggregateFacts.length && (
              <p>
                {groups.some((group) => group.gap != null)
                  ? `各 ${groupBy.toUpperCase()} 投资占比与产出占比的差值均在 ±${threshold} pp 内。`
                  : "当前范围暂无可比较的历史产出。"}
              </p>
            )}
          </section>
          <section>
            <b>② Initiative 分配明细</b>
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
                    {showOwner && ` · Owner：${fact.owner}`}
                    <br />
                    {fact.key}：投资占比 {percentage(fact.amountShare)}，
                    {basis === "c3" ? "C3" : "Delivery Vol"} 占比{" "}
                    {percentage(fact.metricShare)}，
                    <strong>
                      {fact.gap > 0 ? "偏多" : "偏少"}{" "}
                      {amount(Math.abs(fact.gap))} pp
                    </strong>
                  </span>
                  <small>定位到②对应位置 →</small>
                </Button>
              ))}
            {!facts.length && (
              <p>
                {matrix.some((entry) => entry.worst)
                  ? `各 Initiative 在已覆盖 SD 内的偏离均在 ±${threshold} pp 内。`
                  : "当前范围暂无可比较的项目分配。"}
              </p>
            )}
          </section>
          <p className="v19-sd-fact-rule">
            {period === "2025" ? "2025 全年" : "2026 YTD"} ·{" "}
            {basis === "c3" ? "C3" : "Delivery Vol"}；差值 = 投资占比 −
            产出占比。按已勾选名单计算，逐项列出超过 ±{threshold} pp
            的偏离；超过 ±{redThreshold} pp 优先关注。
          </p>
        </div>
      )}
      {variant !== "editor" && (
        <h3>① 各 {groupBy.toUpperCase()} 叠加后 · 投资金额占比 vs 产出占比</h3>
      )}
      <div className="table-scroll">
        <Table
          containerClassName="overflow-visible"
          className="v19-four-groups v19-sd-summary"
        >
          <TableHeader>
            <TableRow>
              <TableHead rowSpan="2">{groupBy.toUpperCase()}</TableHead>
              <TableHead colSpan="9" className="v19-sd-current">
                本次投资
              </TableHead>
              <TableHead colSpan="6" className="v19-sd-actual">
                历史 Actual · {period === "2025" ? "2025 全年" : "2026 YTD"}
              </TableHead>
              <TableHead className="v19-sd-ppp">PPP 目标</TableHead>
              <TableHead colSpan="3" className="v19-sd-history">
                历史投资 · {period === "2025" ? "2025 全年" : "2026 YTD"}
              </TableHead>
            </TableRow>
            <TableRow>
              {[
                "分配 / 名单",
                "投资金额（万）",
                "客均（万）",
                "投资占比",
                `投资 − ${basis === "c3" ? "C3" : "Delivery Vol"}`,
                "占比对照",
                "判断",
                "上版投资（万）",
                "波动率",
              ].map((heading) => (
                <TableHead key={heading} className="v19-sd-current">
                  {heading}
                </TableHead>
              ))}
              {[
                "合同量（KL）",
                "实际 Delivery Vol（KL）",
                "C3（K$）",
                "Phasing",
                "Delivery Vol 占比",
                "C3 占比",
              ].map((heading) => (
                <TableHead key={heading} className="v19-sd-actual">
                  {heading}
                </TableHead>
              ))}
              <TableHead className="v19-sd-ppp">
                目标 {basis === "c3" ? "C3（K$）" : "Vol（KL）"}
              </TableHead>
              {["投资总额（K$）", "Yield", "历史资源占比"].map((heading) => (
                <TableHead key={heading} className="v19-sd-history">
                  {heading}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((group) => (
              <TableRow
                key={group.key}
                id={`${id}-${encodeURIComponent(`summary-${group.key}`)}`}
                tabIndex="-1"
                className={
                  highlight === `summary-${group.key}` ? "v19-highlight" : ""
                }
              >
                <TableHead>{group.key}</TableHead>
                <TableCell className="num">
                  {group.allocatedCount} / {group.selectedCount}
                </TableCell>
                <TableCell className="num">
                  <b>{amount(group.amount, 10000)}</b>
                </TableCell>
                <TableCell className="num">
                  {amount(group.average, 10000)}
                </TableCell>
                <TableCell className="num">
                  {percentage(group.amountShare)}
                </TableCell>
                <TableCell className="num" data-level={level(group.gap)}>
                  {difference(group.gap)}
                </TableCell>
                <TableCell>
                  <ShareComparison
                    investment={group.amountShare}
                    output={group.metricShare}
                    basis={basis}
                  />
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      level(group.gap) === "bad" ? "destructive" : "secondary"
                    }
                    data-level={level(group.gap)}
                  >
                    {group.gap == null
                      ? "不可比较"
                      : Math.abs(group.gap) <= threshold
                        ? "匹配"
                        : group.gap > 0
                          ? "投资偏多"
                          : "投资偏少"}
                  </Badge>
                </TableCell>
                <TableCell className="num">
                  {amount(group.comparison?.previousAmount, 10000)}
                </TableCell>
                <TableCell className="num">
                  {sourceVersionId
                    ? group.comparison?.changeLabel || "不可比较"
                    : "无来源版本"}
                </TableCell>
                <HistoryCells group={group} />
              </TableRow>
            ))}
            {!groups.length && (
              <TableRow>
                <TableCell colSpan="20">
                  <div className="empty">当前范围尚无经销商名单。</div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
          {!!groups.length && (
            <TableFooter>
              <TableRow>
                <TableHead>合计</TableHead>
                <TableCell className="num">
                  {totals.allocatedCount} / {totals.selectedCount}
                </TableCell>
                <TableCell className="num">
                  {amount(totals.amount, 10000)}
                </TableCell>
                <TableCell className="num">
                  {amount(totals.average, 10000)}
                </TableCell>
                <TableCell className="num">
                  {totals.amount ? "100%" : "—"}
                </TableCell>
                <TableCell colSpan="3" />
                <TableCell className="num">
                  {amount(totals.comparison.previousAmount, 10000)}
                </TableCell>
                <TableCell className="num">
                  {sourceVersionId
                    ? totals.comparison.changeLabel
                    : "无来源版本"}
                </TableCell>
                <HistoryCells
                  group={{
                    ...totals,
                    volShare: totals.historicalVol > 0 ? 100 : null,
                    c3Share: totals.historicalC3 > 0 ? 100 : null,
                    historyShare: totals.historicalInvestment > 0 ? 100 : null,
                  }}
                />
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
      <p className="studio-table-note">
        历史 Actual、历史投资按当前名单去重，不随方案金额调整；Yield = C3 合计 ÷
        历史投资合计。PPP 目标尚未提供，缺失数据保留“—”。
      </p>
      {variant !== "editor" && groupBy === "sd" && !!items.length && (
        <>
          <h3>② 各 Initiative 在 SD 间的分配</h3>
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
                  <TableHead className="num">已分配（万）</TableHead>
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
                      {item.name}
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
                            <span title="该项目未覆盖此 SD，不参与偏离判断">
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
            每格 = 该 Initiative 投到该 SD 的投资金额占其已分配的比例；下方为该
            SD 在该 Initiative 名单内的产出占比及差值。未覆盖的 SD
            不参与偏离判断，项目按最大绝对偏离排序。
          </p>
        </>
      )}
    </Card>
  );
}
