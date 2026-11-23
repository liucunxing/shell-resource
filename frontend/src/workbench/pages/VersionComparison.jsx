import { keepUnchanged, readWhileMounted } from "../live-read";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "../../components/ui/sheet";
import { Button } from "../../components/ui/button";
import { VersionDifferenceDrawer } from "./VersionDifferenceDrawer.jsx";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Card } from "../../components/ui/card";
import { Label } from "../../components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "../../components/ui/native-select";
import { Input } from "../../components/ui/input";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "../../components/ui/table";
import { useEffect, useMemo, useState } from "react";
import * as api from "../api.js";
import { useWorkbench } from "../WorkbenchContext.jsx";
import { compareVersionGroups } from "../domain/portfolio-analytics.js";
import { identityScopeKey } from "../identity-scope";
import { submittedVersionItems } from "../domain/version-baseline.js";

const money = (value) =>
  value == null
    ? "不可比较"
    : (Number(value) / 10000).toLocaleString("zh-CN", {
        minimumFractionDigits: 1, maximumFractionDigits: 1,
      });
export function VersionComparison({ executive }) {
  const { state, identity } = useWorkbench();
  const versions = (state.planningVersions || []).filter(
    (version) => version.published,
  );
  const [left, setLeft] = useState(
    state.planningVersion?.sourceVersionId || "",
  );
  const [right, setRight] = useState(state.currentVersionId || "");
  const [dimension, setDimension] = useState("initiative"),
    [result, setResult] = useState(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [query, left, right, dimension]);
  const leftRevision = versions.find(version => version.id === left)?.revision;
  const rightRevision = versions.find(version => version.id === right)?.revision;
  const [detail, setDetail] = useState(null);
  useEffect(() => {
    setResult(null);
    setDetail(null);
    setError("");
    setLoading(false);
    if (!left || !right || left === right) return;
    setLoading(true);
  }, [left, right, identityScopeKey(identity)]);
  useEffect(() => {
    if (!left || !right || left === right) return;
    return readWhileMounted(async active => {
      const [previous, current] = await Promise.all([api.versionComparisonSummary(left), api.versionComparisonSummary(right)]);
      if (active()) {
        setResult(old => keepUnchanged(old, { previous: previous.initiatives, current: current.initiatives }));
        setLoading(false);
        setError("");
      }
    }, { onError: failure => {
      setError(failure.message);
      if ([401, 403, 404].includes(failure.status)) setResult(null);
      setLoading(false);
    } });
  }, [left, right, identityScopeKey(identity), leftRevision, rightRevision]);
  const rows = useMemo(
    () =>
      result
        ? compareVersionGroups(
            result.current,
            result.previous,
            [],
            dimension,
            { requireConfirmed: executive },
          )
        : [],
    [result, dimension, executive],
  );
  const showOwner = executive && dimension === "initiative";
  const filtered = rows.filter(row =>
    `${row.name || row.key} ${showOwner ? row.owner || "" : ""}`.toLowerCase().includes(query.toLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 20));
  const currentPage = Math.min(page, pages);
  return (
    <Card
      id="studio-version-change"
      className="panel studio-section studio-version-compare gap-4 p-4"
    >
      <header>
        <span>{executive ? "⑤" : "⑥"}</span>
        <div>
          <h2>版本变化</h2>
          <p>
            读取两个版本各自最后已提交快照，按当版归属汇总；未提交或未确认分配不可比较，保留退出经销商和退出组织。点击名称查看双版本差异。
          </p>
        </div>
      </header>
      <div className="studio-inline-controls">
        <Label>
          来源版本
          <NativeSelect
            value={left}
            onChange={(event) => setLeft(event.target.value)}
          >
            <NativeSelectOption value="">选择来源版本</NativeSelectOption>
            {versions.map((version) => (
              <NativeSelectOption key={version.id} value={version.id}>
                {version.id} · {version.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Label>
        <span>→</span>
        <Label>
          本版
          <NativeSelect
            value={right}
            onChange={(event) => setRight(event.target.value)}
          >
            <NativeSelectOption value="">选择本版</NativeSelectOption>
            {versions.map((version) => (
              <NativeSelectOption key={version.id} value={version.id}>
                {version.id} · {version.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Label>
      </div>
      <Tabs value={dimension} onValueChange={setDimension}>
        <TabsList aria-label="版本比较维度">
          {[
            ["initiative", "Initiative"],
            ["resourceType", "资源大类"],
            ["department", "部门"],
            ["sector", "Sector"],
          ].map(([id, title]) => (
            <TabsTrigger key={id} value={id}>
              {title}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {error ? (
        <Alert variant="destructive" role="alert" className="note-box warn">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : loading ? (
        <div className="empty">正在读取版本快照…</div>
      ) : !result ? (
        <div className="empty">请选择两个不同的已发布版本。</div>
      ) : (
        <>
          <div className="studio-table-toolbar studio-version-search">
            <Input
              value={query}
              type="search"
              onChange={(event) => setQuery(event.target.value)}
              aria-label={showOwner ? "按项目或 Owner 搜索" : "按项目或维度名称搜索"}
              placeholder={showOwner ? "按项目 / Owner 搜索" : "按项目 / 维度名称搜索"}
            />
          </div>
          <div className="table-scroll v19-comparison-scroll">
            <Table containerClassName="overflow-visible" className={showOwner ? "executive-initiative-comparison" : undefined}
              pageSize={executive ? 20 : undefined} pageIndex={currentPage - 1} onSort={() => setPage(1)}>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    {dimension === "initiative"
                      ? "Initiative"
                      : "汇总维度"}
                  </TableHead>
                  {showOwner && <TableHead>Owner</TableHead>}
                  <TableHead className="num">来源预算（万元）</TableHead>
                  <TableHead className="num">本版预算（万元）</TableHead>
                  <TableHead className="num">预算变化（万元）</TableHead>
                  <TableHead className="num">来源版本投资（万元）</TableHead>
                  <TableHead className="num">本版投资（万元）</TableHead>
                  <TableHead className="num">变化金额（万元）</TableHead>
                  <TableHead className="num">波动率（%）</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell>
                        <Button
                          variant="link"
                          onClick={() =>
                            setDetail({
                              dimension,
                              key: row.key,
                              name: row.name || row.key,
                            })
                          }
                        >
                          {row.name || row.key}
                        </Button>
                      </TableCell>
                      {showOwner && <TableCell sortValue={row.owner || ""}>{row.owner || "—"}</TableCell>}
                      <TableCell className="num" sortValue={row.previousBudget}>
                        {money(row.previousBudget)}
                      </TableCell>
                      <TableCell className="num" sortValue={row.currentBudget}>
                        {money(row.currentBudget)}
                      </TableCell>
                      <TableCell className="num" sortValue={row.budgetDelta}>
                        {money(row.budgetDelta)}
                      </TableCell>
                      <TableCell className="num">
                        {row.comparable
                          ? money(row.previousAmount)
                          : "不可比较"}
                      </TableCell>
                      <TableCell className="num">
                        {row.comparable ? money(row.currentAmount) : "不可比较"}
                      </TableCell>
                      <TableCell className="num">
                        {row.comparable ? money(row.delta) : "不可比较"}
                      </TableCell>
                      <TableCell className="num" sortValue={row.changeRate}>
                        {row.changeLabel?.replace(/%$/, "") ||
                          (row.changeRate == null
                            ? "—"
                            : Number(row.changeRate).toFixed(1))}
                      </TableCell>
                    </TableRow>
                  ))}
                {!filtered.length && (
                  <TableRow>
                    <TableCell colSpan={showOwner ? 9 : 8}>
                      <div className="empty">{rows.length ? "没有匹配的项目。" : "当前授权范围没有可比较项目。"}</div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          {executive && <nav className="v19-list-pagination" aria-label="版本变化分页">
            <span>共 {filtered.length} 条 · 每页 20 条</span>
            <div>
              <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>上一页</Button>
              <span>{currentPage} / {pages}</span>
              <Button variant="outline" size="sm" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>下一页</Button>
            </div>
          </nav>}
        </>
      )}
      {detail && result && (
        <LoadVersionDifference
          key={JSON.stringify([identity.email, left, right])}
          detail={detail}
          leftRevision={leftRevision}
          rightRevision={rightRevision}
          previousVersion={left}
          currentVersion={right}
          executive={executive}
          ytdCutoffMonth={state.ytdCutoffMonth}
          budgetReasons={state.budgetReasons}
          onClose={() => setDetail(null)}
        />
      )}
    </Card>
  );
}


function LoadVersionDifference(props) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    return readWhileMounted(active => Promise.all([api.workspace(props.previousVersion), api.workspace(props.currentVersion)])
      .then(([previous, current]) => {
        if (active())
          setResult(old => keepUnchanged(old, {
            previous: submittedVersionItems(previous),
            current: submittedVersionItems(current),
            previousDealers: previous.data?.dealers || [],
            currentDealers: current.data?.dealers || [],
            dealers: [
              ...new Map(
                [
                  ...(previous.data?.dealers || []),
                  ...(current.data?.dealers || []),
                ].map((dealer) => [`${dealer.sector}:${dealer.id}`, dealer]),
              ).values(),
            ],
          }));
      }), { onError: failure => { setError(failure.message); if ([401, 403].includes(failure.status)) setResult(null); } });
  }, [props.previousVersion, props.currentVersion, props.leftRevision, props.rightRevision]);
  if (result) return <VersionDifferenceDrawer {...props} result={result} />;
  return (
    <Sheet open onOpenChange={(open) => { if (!open) props.onClose(); }}>
      <SheetContent className="resource-detail-drawer">
        <SheetTitle>{props.detail.name}</SheetTitle>
        <SheetDescription role={error ? "alert" : "status"}>
          {error || "正在读取版本明细…"}
        </SheetDescription>
      </SheetContent>
    </Sheet>
  );
}
