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
import { useEffect, useId, useMemo, useState } from "react";
import * as api from "../api.js";
import { useWorkbench } from "../WorkbenchContext.jsx";
import { compareVersionGroups } from "../domain/portfolio-analytics.js";
import { submittedVersionItems } from "../domain/version-baseline.js";

const money = (value) =>
  value == null
    ? "不可比较"
    : (Number(value) / 10000).toLocaleString("zh-CN", {
        maximumFractionDigits: 2,
      });
export function VersionComparison({ executive }) {
  const { state, data, identity } = useWorkbench();
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
  const searchId = useId();
  const [detail, setDetail] = useState(null);
  useEffect(() => {
    let active = true;
    setResult(null);
    setDetail(null);
    setError("");
    setLoading(false);
    if (!left || !right || left === right) return;
    setLoading(true);
    Promise.all([api.workspace(left), api.workspace(right)])
      .then(([previous, current]) => {
        if (active)
          setResult({
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
          });
      })
      .catch((failure) => {
        if (active) setError(failure.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [left, right, identity.email]);
  const rows = useMemo(
    () =>
      result
        ? compareVersionGroups(
            result.current,
            result.previous,
            result.dealers.length ? result.dealers : data.dealers,
            dimension,
            { requireConfirmed: executive },
          )
        : [],
    [result, data.dealers, dimension, executive],
  );
  const showOwner = executive && dimension === "initiative";
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
            <Label htmlFor={searchId}>查找</Label>
            <Input
              id={searchId}
              value={query}
              type="search"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={showOwner ? "项目 / Owner" : "项目 / 维度名称"}
            />
          </div>
          <div className="table-scroll v19-comparison-scroll">
            <Table containerClassName="overflow-visible">
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
                  <TableHead className="num">波动率</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows
                  .filter((row) =>
                    `${row.name || row.key} ${showOwner ? row.owner || "" : ""}`
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                  )
                  .map((row) => (
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
                        {row.changeLabel ||
                          (row.changeRate == null
                            ? "—"
                            : `${Number(row.changeRate).toFixed(1)}%`)}
                      </TableCell>
                    </TableRow>
                  ))}
                {!rows.length && (
                  <TableRow>
                    <TableCell colSpan={showOwner ? 9 : 8}>
                      <div className="empty">当前授权范围没有可比较项目。</div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </>
      )}
      {detail && result && (
        <VersionDifferenceDrawer
          detail={detail}
          result={result}
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
