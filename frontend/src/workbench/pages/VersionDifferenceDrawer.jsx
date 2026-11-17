import { DealerDetailButton } from "../DealerDetailAccess";
import { ResourceDetailDrawer } from "./ResourceDetailDrawer";
import { useEffect, useRef, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "../../components/ui/sheet";
import { Button } from "../../components/ui/button";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Input } from "../../components/ui/input";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../../components/ui/table";
import {
  compareVersionGroups,
  portfolioRows,
} from "../domain/portfolio-analytics.js";
import "../resource-detail.css";

const keyOf = (item) => String(item.initiativeKey || item.id);
const sum = (values) =>
  values.reduce((total, value) => total + (Number(value) || 0), 0);
const money = (value) =>
  value == null
    ? "不可比较"
    : (Number(value) / 10000).toLocaleString("zh-CN", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 2,
      });
const change = (value) =>
  value == null
    ? "不可比较"
    : `${value > 0 ? "+" : value < 0 ? "−" : ""}${money(Math.abs(value))}`;

/** Each side is a submitted snapshot from its own workspace and keeps its own
 * organization attribution. Missing submissions never become an invented zero. */
export function versionDifferenceDetail(result, selection, executive = false) {
  const matches = (item) =>
    item.enabled !== false &&
    String(
      selection.dimension === "initiative"
        ? keyOf(item)
        : item[selection.dimension] || "未配置",
    ) === String(selection.key);
  const previous = result.previous.filter(matches),
    current = result.current.filter(matches);
  const side = (items, dealers) => {
    const available = items.every(
      (item) =>
        item.allocationVisible !== false &&
        item.baselineAvailable !== false &&
        (!executive || item.workflow?.confirmed === true),
    );
    const rows = portfolioRows(
      items.filter(
        (item) =>
          item.allocationVisible !== false &&
          (!executive || item.workflow?.confirmed === true),
      ),
      dealers,
    );
    return {
      items,
      rows,
      available,
      budget: sum(items.map((item) => item.budget)),
      allocation: available ? sum(rows.map((row) => row.amount)) : null,
      reserve: available
        ? sum(
            items.flatMap((item) =>
              (item.otherBudgets || []).map((row) => row.amount),
            ),
          )
        : null,
    };
  };
  const left = side(previous, result.previousDealers || result.dealers || []),
    right = side(current, result.currentDealers || result.dealers || []);
  const lrows = new Map(left.rows.map((row) => [row.key, row])),
    rrows = new Map(right.rows.map((row) => [row.key, row]));
  const comparable = left.available && right.available;
  const dealers = [...new Set([...lrows.keys(), ...rrows.keys()])]
    .map((key) => {
      const before = lrows.get(key),
        after = rrows.get(key),
        a = left.available ? before?.amount || 0 : null,
        b = right.available ? after?.amount || 0 : null;
      return {
        key,
        name: after?.name || before?.name,
        code: after?.code || before?.code,
        sector: after?.sector || before?.sector,
        previous: before,
        current: after,
        previousAmount: a,
        currentAmount: b,
        delta: comparable ? b - a : null,
      };
    })
    .sort(
      (a, b) =>
        Math.abs(b.delta || 0) - Math.abs(a.delta || 0) ||
        a.key.localeCompare(b.key),
    );
  return {
    left,
    right,
    comparable,
    dealers,
    initiatives: compareVersionGroups(
      current,
      previous,
      result.dealers || [],
      "initiative",
      { requireConfirmed: executive },
    ),
  };
}

export function VersionDifferenceDrawer({
  detail,
  result,
  previousVersion,
  currentVersion,
  executive,
  budgetReasons = [],
  ytdCutoffMonth = null,
  onClose,
}) {
  const [dealerDetail, setDealerDetail] = useState(null);
  const [trail, setTrail] = useState([detail]),
    [query, setQuery] = useState("");
  const trigger = useRef(
    typeof document === "undefined" ? null : document.activeElement,
  );
  useEffect(() => {
    setTrail([detail]);
    setQuery("");
  }, [detail]);
  const current = trail.at(-1),
    data = versionDifferenceDetail(result, current, executive);
  const stateLabel = (side) =>
    !side.items.length
      ? "该版本无此项，按 0 比较"
      : !side.available
        ? executive
          ? "存在未确认项目，不可比较"
          : "存在未提交项目，不可比较"
        : "最后已提交快照";
  const metadata = (side) =>
    side.items
      .map(
        (item) =>
          `${item.sector || "—"} / ${item.department || "—"} · ${item.resourceType || "—"} · ${item.ownerName || item.ownerId || "—"}`,
      )
      .filter((value, index, array) => array.indexOf(value) === index)
      .join("；") || "该版本不存在";
  const visible = data.dealers.filter((row) =>
    `${row.name} ${row.code} ${row.sector}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <>
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        className="resource-detail-drawer"
        style={{ "--detail-width": "70vw" }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (trigger.current?.isConnected) trigger.current.focus();
        }}
      >
        <header className="resource-detail-header">
          {trail.length > 1 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setTrail((rows) => rows.slice(0, -1));
                setQuery("");
              }}
            >
              ← 返回上一层
            </Button>
          )}
          <SheetTitle>{current.name || current.key} · 版本差异</SheetTitle>
          <SheetDescription>
            {previousVersion} → {currentVersion} ·
            两个版本各自最后已提交快照；金额单位为万元。
          </SheetDescription>
        </header>
        <div className="resource-detail-content">
          {!data.comparable && (
            <Alert variant="destructive">
              <AlertDescription>
                {executive
                  ? "至少一侧存在未确认的分配。"
                  : "至少一侧缺少已提交快照。"}
                预算可查看，投资、预留和经销商差额不可比较；不会把未提交草稿或缺失金额当作
                0。
              </AlertDescription>
            </Alert>
          )}
          <section className="resource-detail-section">
            <h3>预算、预留与投资前后对照</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>项目</TableHead>
                  <TableHead>{previousVersion}</TableHead>
                  <TableHead>{currentVersion}</TableHead>
                  <TableHead>变化（万元）</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow data-sort-fixed>
                  <TableHead>快照状态</TableHead>
                  <TableCell>{stateLabel(data.left)}</TableCell>
                  <TableCell>{stateLabel(data.right)}</TableCell>
                  <TableCell>—</TableCell>
                </TableRow>
                <TableRow data-sort-fixed>
                  <TableHead>当版归属</TableHead>
                  <TableCell>{metadata(data.left)}</TableCell>
                  <TableCell>{metadata(data.right)}</TableCell>
                  <TableCell>按各版本自己的归属</TableCell>
                </TableRow>
                {[
                  ["预算", data.left.budget, data.right.budget],
                  ["已分配投资", data.left.allocation, data.right.allocation],
                  ["预留", data.left.reserve, data.right.reserve],
                ].map(([label, a, b]) => (
                  <TableRow key={label}>
                    <TableHead>{label}（万元）</TableHead>
                    <TableCell sortValue={a}>{money(a)}</TableCell>
                    <TableCell sortValue={b}>{money(b)}</TableCell>
                    <TableCell sortValue={a == null || b == null ? null : b - a}>
                      {change(a == null || b == null ? null : b - a)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
          {current.dimension !== "initiative" && (
            <section className="resource-detail-section">
              <h3>各 Initiative 的变化</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Initiative</TableHead>
                    <TableHead>{previousVersion} 投资</TableHead>
                    <TableHead>{currentVersion} 投资</TableHead>
                    <TableHead>变化（万元）</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.initiatives.map((item) => (
                    <TableRow key={item.key}>
                      <TableCell>
                        <Button
                          variant="link"
                          onClick={() => {
                            setTrail((rows) => [
                              ...rows,
                              {
                                dimension: "initiative",
                                key: item.key,
                                name: item.name,
                              },
                            ]);
                            setQuery("");
                          }}
                        >
                          {item.name}
                        </Button>
                      </TableCell>
                      <TableCell sortValue={item.previousAmount}>{money(item.previousAmount)}</TableCell>
                      <TableCell sortValue={item.currentAmount}>{money(item.currentAmount)}</TableCell>
                      <TableCell sortValue={item.delta}>{change(item.delta)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="resource-detail-note">
                此汇总按两版各自归属计算；点击项目查看该项目在两版的完整差异，包括转入、转出后的归属。
              </p>
            </section>
          )}
          <section className="resource-detail-section">
            <h3>预留原因前后对照</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>版本</TableHead>
                  <TableHead>Initiative</TableHead>
                  <TableHead>原因 / 说明</TableHead>
                  <TableHead>金额（万元）</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[
                  [previousVersion, data.left],
                  [currentVersion, data.right],
                ].flatMap(([version, side]) =>
                  side.available
                    ? side.items.flatMap((item) =>
                        (item.otherBudgets || []).map((row, index) => (
                          <TableRow key={`${version}-${item.id}-${index}`}>
                            <TableCell>{version}</TableCell>
                            <TableCell><Button variant="link" onClick={() => { setTrail(rows => [...rows, { dimension: "initiative", key: keyOf(item), name: item.name }]); setQuery(""); }}>{item.name}</Button></TableCell>
                            <TableCell>
                              {row.reasonLabel ||
                                row.reason ||
                                budgetReasons.find(
                                  (reason) => reason.id === row.reasonId,
                                )?.label ||
                                row.note ||
                                "未提供原因"}
                              {row.note && <small>{row.note}</small>}
                            </TableCell>
                            <TableCell sortValue={row.amount}>{money(row.amount)}</TableCell>
                          </TableRow>
                        )),
                      )
                    : [
                        <TableRow key={version}>
                          <TableCell>{version}</TableCell>
                          <TableCell colSpan={3}>
                            缺少可见提交快照，预留不可比较
                          </TableCell>
                        </TableRow>,
                      ],
                )}
              </TableBody>
            </Table>
          </section>
          <section className="resource-detail-section">
            <div className="resource-detail-heading">
              <h3>经销商前后投入（{data.dealers.length} 家）</h3>
              <Input
                aria-label="查找版本差异经销商"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="经销商 / 编码 / Sector"
              />
            </div>
            <div className="resource-detail-table">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>经销商</TableHead>
                    <TableHead>经销商编码</TableHead>
                    <TableHead>Sector</TableHead>
                    <TableHead>{previousVersion} SD / RSM</TableHead>
                    <TableHead>{currentVersion} SD / RSM</TableHead>
                    <TableHead>来源投资（万元）</TableHead>
                    <TableHead>本版投资（万元）</TableHead>
                    <TableHead>变化（万元）</TableHead>
                    <TableHead>说明前后</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell>
                        <DealerDetailButton variant="link" onClick={() => setDealerDetail({
                          detail: { type: "dealer", dealerKey: row.key, dealerId: (row.current || row.previous).id, sector: row.sector },
                          items: row.current ? data.right.items : data.left.items,
                          dealers: row.current ? result.currentDealers || result.dealers || [] : result.previousDealers || result.dealers || [],
                        })}>{row.name}</DealerDetailButton>
                      </TableCell>
                      <TableCell>{row.code || "—"}</TableCell>
                      <TableCell>{row.sector}</TableCell>
                      <TableCell>
                        {row.previous
                          ? `${row.previous.sd} / ${row.previous.rsm}`
                          : "未覆盖"}
                      </TableCell>
                      <TableCell>
                        {row.current
                          ? `${row.current.sd} / ${row.current.rsm}`
                          : "本版移除"}
                      </TableCell>
                      <TableCell sortValue={row.previousAmount}>{money(row.previousAmount)}</TableCell>
                      <TableCell sortValue={row.currentAmount}>{money(row.currentAmount)}</TableCell>
                      <TableCell sortValue={row.delta}>{change(row.delta)}</TableCell>
                      <TableCell>
                        {row.previous?.notes.join("；") || "—"} →{" "}
                        {row.current?.notes.join("；") || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!visible.length && (
                    <TableRow>
                      <TableCell colSpan={9}>
                        当前范围没有可见的经销商分配。
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            <p className="resource-detail-note">
              同编码跨 Sector 按不同身份；新增经销商来源金额为
              0，移除经销商本版金额为
              0。只有两侧快照可用才计算差额；搜索不改变汇总。
            </p>
          </section>
        </div>
        <footer className="resource-detail-footer">
          <Button variant="outline" onClick={onClose}>
            关闭版本差异
          </Button>
        </footer>
      </SheetContent>
    </Sheet>
    {dealerDetail && <ResourceDetailDrawer
      {...dealerDetail} budgetReasons={budgetReasons} ytdCutoffMonth={ytdCutoffMonth}
      onClose={() => setDealerDetail(null)}
    />}
    </>
  );
}
