import { SdAnalysis } from "./SdAnalysis.jsx";
import { ResourceDetailDrawer } from "./ResourceDetailDrawer";
import {
  allocationColumnGroups,
  awardedInitiativesByDealer,
  EXPENSE_COLUMN_ORDER,
} from "../domain/allocation-detail";
import "../v19-editor.css";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Fragment, useEffect, useRef, useLayoutEffect, useState } from "react";
import { useWorkbench } from "../WorkbenchContext.jsx";
import E from "../domain/engine.js";
import { allocateByHistory } from "../domain/history-allocation";
import {
  allocationHistoryField,
  historyDisplayValue,
  historyInvestment,
  historyYield,
  historyPhasing,
  finiteHistoryValue,
  historyYoyLabel,
  configuredYtdLabel,
  initiativeDealers,
  isActiveDealer,
} from "../domain/dealer-history";
import { exportExcelInWorker, previewExcelInWorker } from "../file-import.js";
import { concentration, portfolioRows } from "../domain/portfolio-analytics.js";
import * as api from "../api.js";
import {
  reserveAcknowledgementKey,
  reserveAcknowledgementFingerprint,
  canEnterAllocationStep,
} from "../domain/reserve-review.js";
export {
  reserveAcknowledgementKey,
  reserveAcknowledgementFingerprint,
  canEnterAllocationStep,
} from "../domain/reserve-review.js";
const fmt = (n) =>
  Number(n || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const histFmt = (value) =>
  historyDisplayValue(value) === null ? "—" : fmt(historyDisplayValue(value));
const pct = (n, d) => (d ? ((n / d) * 100).toFixed(2) : "0.00");
const time = (v) => (v ? new Date(v).toLocaleString("zh-CN") : "尚未提交");
export function dealerBusinessCode(dealerId, dealer = {}, row = {}) {
  return (
    [dealer.code, row.dealerCode, dealerId].find(
      (value) => value && !String(value).startsWith("history:"),
    ) || "编码未提供"
  );
}
export function dealerDisplayLabel(dealerId, dealer = {}, row = {}) {
  const code = dealerBusinessCode(dealerId, dealer, row);
  const name = dealer.name ? `${dealer.name}（${code}）` : code;
  const organization = [dealer.sd || row.sd, dealer.rsm || row.rsm]
    .filter(Boolean)
    .join(" / ");
  return organization ? `${name} · ${organization}` : name;
}
export function uniqueDealersByCode(dealers) {
  const unique = new Map();
  dealers.forEach((dealer) => {
    const code = String(dealer.id);
    if (!unique.has(code)) unique.set(code, { ...dealer, id: code });
    else {
      const current = unique.get(code);
      current.sector = [
        ...new Set(
          [...(current.sector || "").split(" / "), dealer.sector].filter(
            Boolean,
          ),
        ),
      ].join(" / ");
    }
  });
  return [...unique.values()];
}

export function filterDealers(dealers, codeSearch, nameSearch) {
  const codeQuery = codeSearch.trim().toLocaleLowerCase();
  const nameQuery = nameSearch.trim().toLocaleLowerCase();
  return dealers.filter(
    (dealer) =>
      (!codeQuery ||
        String(dealer.code || dealer.id)
          .toLocaleLowerCase()
          .includes(codeQuery)) &&
      (!nameQuery ||
        String(dealer.name || "")
          .toLocaleLowerCase()
          .includes(nameQuery)),
  );
}

export function toggleDealerSelection(selectedDealers, dealerId) {
  return selectedDealers.includes(dealerId)
    ? selectedDealers.filter((id) => id !== dealerId)
    : [...selectedDealers, dealerId];
}

export function balanceSelectedDealers(rows, selectedIds, pendingAmount) {
  const selected = rows
    .filter((row) => selectedIds.includes(row.dealerId))
    .sort(
      (left, right) =>
        right.amount - left.amount ||
        left.dealerId.localeCompare(right.dealerId),
    );
  if (!selected.length || !Number.isInteger(pendingAmount)) return null;
  const base = Math.trunc(pendingAmount / selected.length);
  const remainder = pendingAmount - base * selected.length;
  const increments = new Map(
    selected.map((row, index) => [
      row.dealerId,
      base + (index < Math.abs(remainder) ? Math.sign(remainder) : 0),
    ]),
  );
  const balanced = rows.map((row) => ({
    ...row,
    amount: row.amount + (increments.get(row.dealerId) || 0),
  }));
  if (balanced.some((row) => row.amount < 0)) return null;
  return balanced;
}

export function MissingHistoryNotice({ metricLabel, unavailable, hasHistory }) {
  if (!unavailable.length) return null;
  return (
    <Alert role="status" className="notice">
      <AlertDescription>
        <p>以下经销商无有效的 {metricLabel} 数据，本次分配默认为 0：</p>
        <ul>
          {unavailable.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
        {!hasHistory && <p>全部经销商均无量，可分配预算保留为未分配差额。</p>}
      </AlertDescription>
    </Alert>
  );
}

export function canSynchronizeLatest({
  savedForSync,
  hasUnsavedChanges,
  errorCount,
  operation,
}) {
  return (
    savedForSync && !hasUnsavedChanges && errorCount === 0 && operation === null
  );
}

export function weightedAllocationYield(rows, dealerById, period) {
  if (!rows.length) return null;
  let output = 0,
    investment = 0;
  for (const row of rows) {
    const history = dealerById.get(String(row.dealerId))?.history;
    const c3 = history?.[period === "2025" ? "c32025" : "c32026Ytd"];
    const expense = historyInvestment(history, period);
    if (
      typeof c3 !== "number" ||
      !Number.isFinite(c3) ||
      expense == null ||
      (period === "2026Ytd" && history?.ytdYieldUnavailableReason)
    )
      return null;
    output += c3;
    investment += expense;
  }
  return output > 0 && investment > 0 ? output / investment : null;
}

export function sortedAllocationRows(rows, valueFor, direction = "desc") {
  return rows
    .map((row, index) => ({ row, index, value: valueFor(row) }))
    .sort((left, right) => {
      const missing = (value) =>
        value == null || (typeof value === "number" && !Number.isFinite(value));
      if (missing(left.value) || missing(right.value))
        return missing(left.value) === missing(right.value)
          ? left.index - right.index
          : missing(left.value)
            ? 1
            : -1;
      const comparison =
        typeof left.value === "number" && typeof right.value === "number"
          ? left.value - right.value
          : String(left.value).localeCompare(String(right.value), "zh-CN", {
              numeric: true,
            });
      return (
        (direction === "desc" ? -comparison : comparison) ||
        left.index - right.index
      );
    })
    .map(({ row }) => row);
}

function SortHead({ sortKey, sort, onSort, children, ...props }) {
  return (
    <TableHead
      {...props}
      aria-sort={
        sort.key === sortKey
          ? sort.direction === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
    >
      <Button variant="ghost" onClick={() => onSort(sortKey)}>
        {children}
        <span aria-hidden="true">
          {sort.key === sortKey ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </Button>
    </TableHead>
  );
}

function RatioIndicator({ value, average }) {
  if (value == null || value <= 0) return <span>—</span>;
  const tone =
    average > 0
      ? value > average * 1.1
        ? "good"
        : value < average * 0.9
          ? "bad"
          : "mid"
      : "none";
  return (
    <span className={`v19-ratio ${tone}`}>
      <b>{value.toFixed(2)}</b>
      {tone !== "none" && (
        <small>
          {tone === "good" ? "优" : tone === "bad" ? "关注" : "近均"}
        </small>
      )}
    </span>
  );
}

function HistoryControls({
  period,
  onPeriodChange,
  metric,
  onMetricChange,
  ytdCutoffMonth = 10,
}) {
  return (
    <div className="v19-editor-history">
      <span>历史参考</span>
      <Tabs value={period} onValueChange={onPeriodChange}>
        <TabsList aria-label="历史期间">
          <TabsTrigger value="2025">2025 全年</TabsTrigger>
          <TabsTrigger value="2026Ytd">
            {configuredYtdLabel(ytdCutoffMonth)}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {onMetricChange && (
        <Tabs
          value={metric === "vol" ? "vol" : "c3"}
          onValueChange={onMetricChange}
        >
          <TabsList aria-label="历史产出口径">
            <TabsTrigger value="vol">Vol</TabsTrigger>
            <TabsTrigger value="c3">C3</TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      <span
        className="v19-history-info"
        title="Actual 与费用覆盖以数据源为准。合同量列对应经销商目标；YTD实际对照同期间目标，缺失或非正数时不算 Phasing。"
      >
        !
      </span>
    </div>
  );
}
function AmountInput({ value, label, save, disabled = false }) {
  const [raw, setRaw] = useState(null);
  const [failed, setFailed] = useState(false);
  const valid =
    raw === null ||
    (/^\d+(\.\d{0,2})?$/.test(raw) && E.validMoney(Number(raw)));
  return (
    <Input
      type="text"
      inputMode="decimal"
      disabled={disabled}
      aria-label={label}
      aria-invalid={!valid || failed}
      data-unsaved-invalid={!valid || failed ? "true" : undefined}
      className={!valid || failed ? "inline-error" : ""}
      value={raw ?? value}
      onChange={(e) => {
        const next = e.target.value;
        setRaw(next);
        if (/^\d+(\.\d{0,2})?$/.test(next) && E.validMoney(Number(next)))
          setFailed(save(Number(next)) === false);
      }}
      onBlur={() => {
        if (valid && !failed) setRaw(null);
      }}
    />
  );
}
function EditorDialog({ title, children, action, close }) {
  const previous = useRef(
    typeof document === "undefined" ? null : document.activeElement,
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        className="w-[96vw] sm:max-w-[1480px] max-h-[85dvh] overflow-auto"
        showCloseButton={false}
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (previous.current?.isConnected) previous.current.focus();
        }}
      >
        <DialogHeader className="flex-row items-center justify-between gap-4">
          <DialogTitle>{title}</DialogTitle>
          <Button variant="ghost" onClick={close} aria-label="关闭弹窗">
            关闭
          </Button>
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            取消 / 返回
          </Button>
          {action}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
export function EditorPage() {
  const context = useWorkbench();
  return (
    <EditorContent
      key={
        context.state.planningVersion?.id +
        ":" +
        context.initiativeId +
        ":" +
        JSON.stringify(context.identity)
      }
      {...context}
    />
  );
}
function EditorContent({
  state,
  data,
  identity,
  view,
  initiativeId,
  navigate,
  mutate,
  saveDraft,
  publish,
  apiMode,
  previewMode,
  dirtyIds,
  savedForSyncIds,
  editorOperations,
  directoryStatus,
  loadDistributorDirectory,
  notify,
}) {
  const acknowledgementKey = reserveAcknowledgementKey(
    identity,
    state.planningVersion?.id,
    initiativeId,
  );
  const acknowledgementFingerprint = reserveAcknowledgementFingerprint(
    view.initiatives.find((item) => item.id === initiativeId),
  );
  const [reserveAcknowledgement, setReserveAcknowledgement] = useState(() => {
    try {
      return sessionStorage.getItem(acknowledgementKey) || "";
    } catch {
      return "";
    }
  });
  const previousAcknowledgement = useRef({
    key: acknowledgementKey,
    fingerprint: acknowledgementFingerprint,
  });
  const [detail, setDetail] = useState(null);
  const [modal, setModal] = useState(null),
    [newDealers, setNewDealers] = useState([]),
    [dealerCodeSearch, setDealerCodeSearch] = useState(""),
    [dealerNameSearch, setDealerNameSearch] = useState(""),
    [historyMetric, setHistoryMetric] = useState("c3"),
    [historyPeriod, setHistoryPeriod] = useState("2025"),
    [trialPeriod, setTrialPeriod] = useState("2025"),
    [activeStep, setActiveStep] = useState(1),
    [balanceIds, setBalanceIds] = useState([]),
    [scopeSearch, setScopeSearch] = useState(""),
    [scopeSd, setScopeSd] = useState("all"),
    [scopeRsm, setScopeRsm] = useState("all"),
    [scopeStatus, setScopeStatus] = useState("all"),
    [scopePage, setScopePage] = useState(1),
    [trialCompare, setTrialCompare] = useState(false),
    [allocationQuery, setAllocationQuery] = useState(""),
    [allocatedOnly, setAllocatedOnly] = useState(false),
    [allocationSort, setAllocationSort] = useState({
      key: "amount",
      direction: "desc",
    }),
    [allocationPage, setAllocationPage] = useState(1),
    [changeReason, setChangeReason] = useState(
      () =>
        view.initiatives.find((item) => item.id === initiativeId)
          ?.changeReason || "",
    ),
    [undo, setUndo] = useState(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const previous = previousAcknowledgement.current;
    if (previous.key !== acknowledgementKey) {
      let stored = "";
      try {
        stored = sessionStorage.getItem(acknowledgementKey) || "";
      } catch {}
      setReserveAcknowledgement(stored);
      setActiveStep(1);
    } else if (previous.fingerprint !== acknowledgementFingerprint) {
      setReserveAcknowledgement("");
      setActiveStep(1);
      try {
        sessionStorage.removeItem(acknowledgementKey);
      } catch {}
    }
    previousAcknowledgement.current = {
      key: acknowledgementKey,
      fingerprint: acknowledgementFingerprint,
    };
  }, [acknowledgementKey, acknowledgementFingerprint]);
  const allocationScroll = useRef(null);
  useLayoutEffect(() => {
    const viewport = allocationScroll.current;
    const header = viewport?.querySelector("thead");
    if (!viewport || !header) return;
    const navigation = viewport.closest(".workspace")?.querySelector(".v19-appnav");
    const stickHeader = () => {
      const pageTop = Math.max(0, navigation?.getBoundingClientRect().bottom ?? 0);
      const tableTop = viewport.getBoundingClientRect().top + viewport.clientTop;
      const headerHeight = header.getBoundingClientRect().height;
      const bottomLimit = Math.max(0, viewport.clientHeight - headerHeight);
      const top = Math.min(Math.max(0, pageTop - tableTop), bottomLimit);
      viewport.style.setProperty("--allocation-header-top", `${top}px`);
      viewport.style.scrollPaddingTop = `${top + headerHeight}px`;
    };
    let frame = 0;
    const update = (event) => {
      if (event?.target === viewport || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        stickHeader();
      });
    };
    const resize = new ResizeObserver(() => update());
    resize.observe(viewport);
    resize.observe(header);
    if (navigation) resize.observe(navigation);
    // Keep the header below navigation when the page scrolls past the table's top edge.
    window.addEventListener("scroll", update, { capture: true, passive: true });
    stickHeader();
    return () => {
      window.removeEventListener("scroll", update, true);
      resize.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [activeStep]);
  const selectionViewport = useRef(null);
  useLayoutEffect(() => {
    const saved = selectionViewport.current;
    if (!saved) return;
    selectionViewport.current = null;
    for (const [element, top, left] of saved.parents) {
      element.scrollTop = top;
      element.scrollLeft = left;
    }
    window.scrollTo({ top: saved.y, left: saved.x, behavior: "instant" });
  });
  const rememberSelectionViewport = () => {
    const parents = [];
    for (
      let element = document.activeElement?.parentElement;
      element;
      element = element.parentElement
    )
      parents.push([element, element.scrollTop, element.scrollLeft]);
    selectionViewport.current = {
      parents,
      x: window.scrollX,
      y: window.scrollY,
    };
  };
  const fileRef = useRef(null),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (apiMode) void loadDistributorDirectory();
  }, [apiMode, loadDistributorDirectory]);
  const i = view.initiatives.find((item) => item.id === initiativeId);
  const hasUnsavedChanges = i ? dirtyIds.has(i.id) : false;
  if (!i) return <div className="empty">当前角色无权查看该明细。</div>;
  const operation = editorOperations[i.id] || null;
  const savedForSync = savedForSyncIds.has(i.id);
  const editable = !previewMode && E.canEdit(state, i.id, identity),
    totals = E.totals([i]),
    errors = E.completionErrors(i, data, state.budgetReasons);
  const reserveConfirmed =
    previousAcknowledgement.current.key === acknowledgementKey &&
    reserveAcknowledgement === acknowledgementFingerprint;
  const acknowledgeReserve = (checked) => {
    const value = checked ? acknowledgementFingerprint : "";
    setReserveAcknowledgement(value);
    try {
      if (value) sessionStorage.setItem(acknowledgementKey, value);
      else sessionStorage.removeItem(acknowledgementKey);
    } catch {}
  };
  const chooseStep = (step) => {
    if (!canEnterAllocationStep(step, editable, reserveConfirmed)) {
      setActiveStep(1);
      notify("请先核对本版预算与预留并勾选确认。", true);
      return;
    }
    setActiveStep(step);
  };
  const synchronizedRevision =
    i.publishedRevision != null &&
    i.publishedRevision === i.revision &&
    (!i.workflow || i.workflow.submitted);
  const canSynchronize =
    editable &&
    (!state.planningVersion?.sourceVersionId ||
      changeReason.trim().length > 0) &&
    canSynchronizeLatest({
      savedForSync,
      hasUnsavedChanges,
      errorCount: errors.length,
      operation,
    });
  const guard = () => {
    if (document.querySelector('[data-unsaved-invalid="true"]')) {
      notify(
        "有尚未保存的无效输入，请填写非负金额（最多两位小数）后继续。",
        true,
      );
      return false;
    }
    return true;
  };
  const update = (patch) => {
    const previous = {
      rows: structuredClone(i.rows),
      otherBudgets: structuredClone(i.otherBudgets),
    };
    const changed = mutate((s) =>
      E.updateInitiative(s, i.id, patch, identity, data),
    );
    if (changed) setUndo(previous);
    return changed;
  };
  const doGuard = (fn) => {
    if (guard()) fn();
  };
  const handleSaveDraft = async () => {
    if (operation !== null || !guard()) return;
    await saveDraft(i.id, { changeReason: changeReason.trim() });
  };
  const handlePublish = async () => {
    if (operation !== null || !canSynchronize || !guard()) return;
    if (!reserveConfirmed) {
      chooseStep(1);
      notify("请先核对本版预算与预留并勾选确认。", true);
      return;
    }
    await publish(i.id, changeReason.trim());
  };
  const directoryDealers = apiMode
    ? data.distributorDirectory || []
    : data.dealers;
  const dealers = initiativeDealers(
    data.dealers || [],
    directoryDealers,
    i.sector,
  );
  const available = dealers.filter(
    (d) => isActiveDealer(d) && !i.rows.some((r) => r.dealerId === d.id),
  );
  const dealerById = new Map(dealers.map((d) => [String(d.id), d]));
  const dealerName = (dealerId) =>
    dealerById.get(String(dealerId))?.name || "—";
  const dealerMeta = (dealerId) => dealerById.get(String(dealerId)) || {};
  const dealerCode = (dealerId) =>
    dealerBusinessCode(
      dealerId,
      dealerMeta(dealerId),
      i.rows.find((row) => row.dealerId === dealerId),
    );
  const dealerLabel = (dealerId) =>
    dealerDisplayLabel(
      dealerId,
      dealerMeta(dealerId),
      i.rows.find((row) => row.dealerId === dealerId),
    );
  const searchedDealers = filterDealers(
    available,
    dealerCodeSearch,
    dealerNameSearch,
  );
  const scopeDealers = dealers.filter((dealer) => {
    const term = scopeSearch.trim().toLowerCase();
    return (
      (!term ||
        `${dealer.code || dealer.id} ${dealer.name || ""}`
          .toLowerCase()
          .includes(term)) &&
      (scopeSd === "all" || dealer.sd === scopeSd) &&
      (scopeRsm === "all" || dealer.rsm === scopeRsm) &&
      (scopeStatus === "all" || dealer.status === scopeStatus)
    );
  });
  const scopeOptions = (key) =>
    [...new Set(dealers.map((dealer) => dealer[key]).filter(Boolean))].sort();
  const changeRow = (n, amount) =>
    update({
      rows: i.rows.map((r, index) => (index === n ? { ...r, amount } : r)),
    });
  const addReserve = () =>
    doGuard(() => {
      const reason = state.budgetReasons.find((item) => item.enabled);
      if (!reason) return notify("请先由管理员启用预算原因。", true);
      update({
        otherBudgets: [
          ...i.otherBudgets,
          {
            id: "OB-" + crypto.randomUUID(),
            reasonId: reason.id,
            amount: 0,
            note: i.workflow ? reason.label : "",
          },
        ],
      });
    });
  const changeOther = (n, field, value) =>
    update({
      otherBudgets: i.otherBudgets.map((r, index) =>
        index === n
          ? {
              ...r,
              [field]: value,
              ...(field === "reasonId" && i.workflow
                ? {
                    note:
                      state.budgetReasons.find((reason) => reason.id === value)
                        ?.label || "",
                  }
                : {}),
            }
          : r,
      ),
    });
  const close = () => setModal(null);
  const download = async (directoryOnly = false) => {
    const previewEpoch = getPreviewEpoch();
    if (!directoryOnly && !guard()) return;
    setBusy(true);
    try {
      const directory = apiMode
        ? await loadDistributorDirectory()
        : data.dealers;
      if (!Array.isArray(directory))
        throw Error("经销商目录加载失败，暂不能下载，请稍后重试。");
      const exportData = { ...data, distributorDirectory: directory };
      const bytes = directoryOnly
        ? await exportExcelInWorker("directory", exportData)
        : await exportExcelInWorker(
            "allocation",
            state,
            i.id,
            identity,
            exportData,
          );
      await validatePortalSession();
      assertPreviewResponseCurrent(previewEpoch);
      if (!alive.current) return;
      const url = URL.createObjectURL(
        new Blob([bytes], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = directoryOnly
        ? "经销商列表.xlsx"
        : `${i.department}_${i.name}_${i.id}_分配模板.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      if (alive.current && previewEpoch === getPreviewEpoch())
        notify(e.message, true);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const importFile = async (file) => {
    if (!file || !guard()) return;
    setBusy(true);
    try {
      if (file.size > 10 * 1024 * 1024)
        throw Error("模板请控制在 10 MB 以内。");
      const buffer = await file.arrayBuffer();
      const preview = await previewExcelInWorker(
        "allocation",
        buffer,
        state,
        i.id,
        identity,
        data,
      );
      if (alive.current) setModal({ type: "import", preview, name: file.name });
    } catch (e) {
      notify(e.message, true);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const historyFill = (metric, period = historyPeriod) =>
    doGuard(() => {
      try {
        const available = E.cents(i.budget - totals.otherBudget);
        if (available < 0)
          throw Error("其他预算安排超过总预算，无法辅助填充。");
        const field = allocationHistoryField(metric, period);
        const label = `${period === "2026Ytd" ? "2026 YTD" : "2025 全年"} ${metric === "vol" ? "Delivery Vol" : metric === "investment" ? "历史投资" : "C3"}`;
        const allocation = allocateByHistory(
          i.rows,
          dealers,
          available,
          field,
          i.sector,
          directoryDealers,
        );
        setModal({
          type: "fill",
          revision: i.revision,
          metricLabel: label,
          ...allocation,
          unavailable: allocation.unavailable.map((label) => {
            const row = i.rows.find((entry) =>
              label.endsWith(`（${entry.dealerId}）`),
            );
            return row ? dealerLabel(row.dealerId) : label;
          }),
        });
      } catch (e) {
        notify(e.message, true);
      }
    });
  const history = state.publications?.[i.id] || [];
  const restoreSource = async () => {
    if (!editable || !state.planningVersion?.sourceVersionId) return;
    setBusy(true);
    try {
      const source = await api.workspace(state.planningVersion.sourceVersionId);
      const prior = source.state.initiatives.find(
        (item) =>
          String(item.initiativeKey || item.id) ===
          String(i.initiativeKey || i.id),
      );
      const submitted =
        prior && source.state.publications?.[prior.id]?.at(-1)?.initiative;
      if (!submitted) throw Error("来源版本没有本项目的已提交快照。");
      setModal({
        type: "restore",
        title: "复制来源版本最后已提交方案",
        rows: submitted.rows || [],
        otherBudgets: (submitted.otherBudgets || []).map((row) => ({
          ...row,
          id: "OB-" + crypto.randomUUID(),
        })),
      });
    } catch (failure) {
      notify(failure.message, true);
    } finally {
      setBusy(false);
    }
  };
  const otherInitiatives = (dealerId) =>
    view.initiatives
      .filter(
        (item) =>
          item.id !== i.id &&
          item.ownerId === i.ownerId &&
          item.sector === i.sector,
      )
      .flatMap((item) =>
        (item.rows || [])
          .filter(
            (row) =>
              String(row.dealerId) === String(dealerId) && row.amount > 0,
          )
          .map((row) => ({ item, row })),
      );
  const selectedInvestment = (period) => {
    const values = i.rows.map((row) =>
      historyInvestment(dealerMeta(row.dealerId).history, period),
    );
    return values.every((value) => value != null)
      ? values.reduce((sum, value) => sum + value, 0)
      : null;
  };
  const investmentShareFor = (dealerId, period) => {
    const total = selectedInvestment(period),
      value = historyInvestment(dealerMeta(dealerId).history, period);
    return i.rows.some((row) => row.dealerId === dealerId) &&
      value != null &&
      total > 0
      ? (value / total) * 100
      : null;
  };
  const historyVolKey = historyPeriod === "2026Ytd" ? "vol2026Ytd" : "vol2025";
  const historyC3Key = historyPeriod === "2026Ytd" ? "c32026Ytd" : "c32025";
  const historyContractKey =
    historyPeriod === "2026Ytd" ? "contract2026Ytd" : "contract2025";
  const contracts = i.rows.map((row) =>
    finiteHistoryValue(dealerMeta(row.dealerId).history?.[historyContractKey]),
  );
  const contractTotal =
    contracts.length && contracts.every((value) => value !== null)
      ? contracts.reduce((sum, value) => sum + value, 0)
      : null;
  const scopeHistoryTotals = i.rows.reduce(
    (sum, row) => {
      const historyRow = dealerMeta(row.dealerId).history || {};
      sum.vol += Number(historyRow[historyVolKey]) || 0;
      sum.c3 += Number(historyRow[historyC3Key]) || 0;
      sum.volComplete &&= historyRow[historyVolKey] != null;
      sum.c3Complete &&= historyRow[historyC3Key] != null;
      return sum;
    },
    { vol: 0, c3: 0, volComplete: true, c3Complete: true },
  );
  const weightedYield = weightedAllocationYield(
    i.rows,
    dealerById,
    historyPeriod,
  );
  const allocationInvestmentTotal = selectedInvestment(historyPeriod);
  const allocationExpenses = EXPENSE_COLUMN_ORDER.filter((type) =>
    i.rows.some((row) =>
      Object.hasOwn(
        dealerMeta(row.dealerId).history?.[
          historyPeriod === "2025" ? "resources2025" : "resources2026Ytd"
        ] || {},
        type,
      ),
    ),
  );
  const allocationGroups = allocationColumnGroups(allocationExpenses, true);
  const allocationColumns = allocationGroups.flatMap((group) => group.columns);
  const awardsByDealer = awardedInitiativesByDealer(i, view.initiatives);
  const detailItems = detail?.ownerOthers
    ? otherInitiatives(detail.dealerId).map(({ item }) => item)
    : detail?.awardedProject
      ? (awardsByDealer.get(detail.dealerId) || []).filter(
          (item) => item.id === detail.initiativeId,
        )
      : detail?.previewRows
        ? [{ ...i, rows: detail.previewRows }]
        : [i];
  const weightedPhasing =
    scopeHistoryTotals.volComplete && contractTotal > 0
      ? scopeHistoryTotals.vol / contractTotal
      : null;
  const allocationValue = (row, key) => {
    const dealer = dealerMeta(row.dealerId),
      h = dealer.history || {};
    const amountShare =
      totals.allocated > 0 ? (row.amount / totals.allocated) * 100 : null;
    const volShare =
      scopeHistoryTotals.volComplete &&
      scopeHistoryTotals.vol > 0 &&
      h[historyVolKey] != null
        ? (h[historyVolKey] / scopeHistoryTotals.vol) * 100
        : null;
    const c3Share =
      scopeHistoryTotals.c3Complete &&
      scopeHistoryTotals.c3 > 0 &&
      h[historyC3Key] != null
        ? (h[historyC3Key] / scopeHistoryTotals.c3) * 100
        : null;
    if (key.startsWith("expense:"))
      return (
        h[historyPeriod === "2025" ? "resources2025" : "resources2026Ytd"]?.[
          key.slice(8)
        ] ?? null
      );
    return {
      name: dealer.name || dealerCode(row.dealerId),
      amount: row.amount,
      sd: dealer.sd,
      rsm: dealer.rsm,
      amountShare,
      volShare,
      c3Share,
      gapVol:
        amountShare != null && volShare != null ? amountShare - volShare : null,
      gapC3:
        amountShare != null && c3Share != null ? amountShare - c3Share : null,
      contract: finiteHistoryValue(h[historyContractKey]),
      contractShare:
        h[historyContractKey] != null && contractTotal > 0
          ? (h[historyContractKey] / contractTotal) * 100
          : null,
      vol: finiteHistoryValue(h[historyVolKey]),
      c3: finiteHistoryValue(h[historyC3Key]),
      phasing: historyPhasing(h, historyPeriod),
      investment: historyInvestment(h, historyPeriod),
      yield: historyYield(h, historyPeriod),
      investmentShare: investmentShareFor(row.dealerId, historyPeriod),
      note: row.note || "",
    }[key];
  };
  const allocationFormat = (value, key) =>
    [
      "amountShare",
      "volShare",
      "c3Share",
      "contractShare",
      "investmentShare",
    ].includes(key)
      ? value == null
        ? "—"
        : `${fmt(value)}%`
      : key === "phasing"
        ? value == null
          ? "—"
          : `${fmt(value * 100)}%`
        : key === "gapVol" || key === "gapC3"
          ? value == null
            ? "—"
            : `${value > 0 ? "+" : ""}${fmt(value)}pp`
          : key === "yield"
            ? value == null || value <= 0
              ? "—"
              : fmt(value)
            : ["contract", "vol", "c3", "investment"].includes(key) ||
                key.startsWith("expense:")
              ? histFmt(value)
              : (value ?? "—");
  const totalAllocationValue = (key) => {
    if (key.startsWith("expense:")) {
      const values = i.rows.map((row) => allocationValue(row, key));
      return values.length && values.every((value) => value != null)
        ? values.reduce((sum, value) => sum + value, 0)
        : null;
    }
    return (
      {
        amount: totals.allocated,
        amountShare: totals.allocated > 0 ? 100 : null,
        volShare:
          scopeHistoryTotals.volComplete && scopeHistoryTotals.vol > 0
            ? 100
            : null,
        c3Share:
          scopeHistoryTotals.c3Complete && scopeHistoryTotals.c3 > 0
            ? 100
            : null,
        contract: contractTotal,
        contractShare: contractTotal > 0 ? 100 : null,
        vol: scopeHistoryTotals.volComplete ? scopeHistoryTotals.vol : null,
        c3: scopeHistoryTotals.c3Complete ? scopeHistoryTotals.c3 : null,
        phasing: weightedPhasing,
        investment: allocationInvestmentTotal,
        yield: weightedYield,
        investmentShare: allocationInvestmentTotal > 0 ? 100 : null,
      }[key] ?? null
    );
  };
  const allocationFiltered = i.rows.filter(
    (row) =>
      (!allocatedOnly || row.amount > 0) &&
      (!allocationQuery.trim() ||
        dealerLabel(row.dealerId)
          .toLocaleLowerCase()
          .includes(allocationQuery.trim().toLocaleLowerCase())),
  );
  const allocationSorted = sortedAllocationRows(
    allocationFiltered,
    (row) => allocationValue(row, allocationSort.key),
    allocationSort.direction,
  );
  const allocationPages = Math.max(1, Math.ceil(allocationSorted.length / 20));
  const currentAllocationPage = Math.min(allocationPage, allocationPages);
  const displayedAllocationRows = allocationSorted.slice(
    (currentAllocationPage - 1) * 20,
    currentAllocationPage * 20,
  );
  const sortAllocation = (key) => {
    setAllocationSort((value) => ({
      key,
      direction:
        value.key === key && value.direction === "desc" ? "asc" : "desc",
    }));
    setAllocationPage(1);
  };
  const jumpAllocation = (group) => {
    const container = allocationScroll.current,
      target = container?.querySelector(`[data-v19-column-group="${group}"]`);
    if (container && target)
      container.scrollTo({ left: target.offsetLeft, behavior: "smooth" });
  };
  return (
    <>
      {operation && (
        <>
          <div className="editor-operation-overlay" aria-hidden="true" />
          <div
            className="editor-operation-status"
            role="status"
            aria-live="assertive"
          >
            <span className="admin-loading-spinner" aria-hidden="true" />
            <strong>
              {operation === "save" ? "正在保存草稿…" : "正在提交方案…"}
            </strong>
            <span>当前工作页暂不可操作，可切换左侧目录</span>
          </div>
        </>
      )}
      <div
        className="v19-editor"
        inert={operation !== null}
        aria-busy={operation !== null}
      >
        <div className="page-heading">
          <div>
            <span className="resource-eyebrow">ALLOCATION WORKSPACE</span>
            <h1>{i.name}</h1>
            <p>
              {i.id} · {i.sector} / {i.department} · {i.resourceType} · Owner{" "}
              {i.ownerId}
            </p>
          </div>
          <Button
            variant="outline"
            className="button"
            onClick={() =>
              doGuard(() =>
                navigate(identity.role === "owner" ? "home" : "department"),
              )
            }
          >
            返回列表
          </Button>
        </div>
        <div className="v19-work-version">
          <span>
            当前版本{" "}
            <strong>
              {state.planningVersion?.id} · {state.planningVersion?.name}
            </strong>
          </span>
          <Badge variant="secondary">
            {editable ? "开放提交" : i.workflow?.submitted ? "已提交" : "只读"}
          </Badge>
        </div>
        <Tabs
          value={String(activeStep)}
          onValueChange={(step) => chooseStep(Number(step))}
          className="v19-workspace-tabs"
        >
          <TabsList aria-label="拆分工作台">
            <TabsTrigger value="1">预算与预留</TabsTrigger>
            <TabsTrigger
              value="2"
              disabled={!canEnterAllocationStep(2, editable, reserveConfirmed)}
            >
              经销商范围
            </TabsTrigger>
            <TabsTrigger
              value="3"
              disabled={!canEnterAllocationStep(3, editable, reserveConfirmed)}
            >
              试算、微调与提交
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="v19-work-budget-cards" aria-label="项目预算概况">
          {[
            ["本版总预算", totals.budget, "这个项目在当前版本可用的全部预算"],
            [
              "预留不分配",
              totals.otherBudget,
              "暂不分给经销商的钱；每笔需说明原因",
            ],
            [
              "当前已分配",
              totals.allocated,
              "草稿中已分给经销商的钱，提交后上级才会看到",
            ],
            ["待分配", totals.gap, "还没安排的钱，可继续分配或填写原因后预留"],
          ].map(([label, value, note], index) => (
            <Card
              key={label}
              className={
                index === 0 ? "v19-budget-card accent" : "v19-budget-card"
              }
            >
              <span>{label}</span>
              <strong>
                {(value / 10000).toLocaleString("zh-CN", {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                })}
                <small> 万元</small>
              </strong>
              <p>{note}</p>
            </Card>
          ))}
        </div>
        {!editable && (
          <Alert className="note-box">
            <AlertDescription>
              {i.workflow?.submitted
                ? "方案已提交，当前为只读。需修改时请由部门负责人退回该项目；撤回部门确认本身不会开放编辑。"
                : "当前方案只读，请核对版本开放状态、截止时间和 Owner 归属。"}
            </AlertDescription>
          </Alert>
        )}
        {i.workflow?.requiresResubmission && (
          <Alert className="note-box warn">
            <AlertDescription>
              待重新提交 · {i.workflow.returnReason}
            </AlertDescription>
          </Alert>
        )}
        <div className="editor-layout">
          {activeStep === 2 && (
            <>
              <Card className="panel studio-scope-panel">
                <div className="panel-header">
                  <div>
                    <h2>定义适用经销商</h2>
                    <p className="small-text muted">
                      直接来自历史列表；SD、RSM、状态及历史指标只读。
                    </p>
                  </div>
                </div>
                <div className="studio-scope-summary">
                  {scopeOptions("sd").map((sd) => {
                    const all = dealers.filter((dealer) => dealer.sd === sd);
                    const picked = all.filter((dealer) =>
                      i.rows.some((row) => row.dealerId === dealer.id),
                    );
                    const coverage = (key) => {
                      if (all.some((dealer) => dealer.history?.[key] == null))
                        return "—";
                      const total = all.reduce(
                        (sum, dealer) => sum + Number(dealer.history[key]),
                        0,
                      );
                      return total > 0
                        ? `${((picked.reduce((sum, dealer) => sum + Number(dealer.history[key]), 0) / total) * 100).toFixed(1)}%`
                        : "—";
                    };
                    return (
                      <div key={sd}>
                        <b>{sd}</b>
                        <p>
                          已选 {picked.length} / {all.length} 家
                        </p>
                        <small>
                          2025 · Vol 覆盖 {coverage("vol2025")} · C3 覆盖{" "}
                          {coverage("c32025")}
                        </small>
                        <small>
                          2026 YTD · Vol 覆盖 {coverage("vol2026Ytd")} · C3 覆盖{" "}
                          {coverage("c32026Ytd")}
                        </small>
                      </div>
                    );
                  })}
                </div>
                <div className="studio-table-toolbar">
                  <Input
                    type="search"
                    placeholder="搜索经销商名称 / 编码"
                    value={scopeSearch}
                    onChange={(event) => {
                      setScopeSearch(event.target.value);
                      setScopePage(1);
                    }}
                  />
                  <NativeSelect
                    value={scopeSd}
                    onChange={(event) => {
                      setScopeSd(event.target.value);
                      setScopePage(1);
                    }}
                  >
                    <NativeSelectOption value="all">全部 SD</NativeSelectOption>
                    {scopeOptions("sd").map((value) => (
                      <NativeSelectOption key={value}>
                        {value}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <NativeSelect
                    value={scopeRsm}
                    onChange={(event) => {
                      setScopeRsm(event.target.value);
                      setScopePage(1);
                    }}
                  >
                    <NativeSelectOption value="all">
                      全部 RSM
                    </NativeSelectOption>
                    {scopeOptions("rsm").map((value) => (
                      <NativeSelectOption key={value}>
                        {value}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <NativeSelect
                    value={scopeStatus}
                    onChange={(event) => {
                      setScopeStatus(event.target.value);
                      setScopePage(1);
                    }}
                  >
                    <NativeSelectOption value="all">
                      全部状态
                    </NativeSelectOption>
                    {scopeOptions("status").map((value) => (
                      <NativeSelectOption key={value}>
                        {value}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  {editable && (
                    <Button
                      variant="outline"
                      className="button small"
                      disabled={!scopeDealers.length}
                      onClick={() => {
                        doGuard(() =>
                          update({
                            rows: [
                              ...i.rows,
                              ...scopeDealers
                                .filter(
                                  (dealer) =>
                                    isActiveDealer(dealer) &&
                                    !i.rows.some(
                                      (row) => row.dealerId === dealer.id,
                                    ),
                                )
                                .map((dealer) => ({
                                  dealerId: dealer.id,
                                  amount: 0,
                                  note: "",
                                })),
                            ],
                          }),
                        );
                      }}
                    >
                      加入筛选结果
                    </Button>
                  )}
                </div>
                <div className="table-scroll studio-wide-table">
                  <Table
                    containerClassName="overflow-visible"
                    className="v19-scope-review"
                  >
                    <TableHeader>
                      <TableRow>
                        <TableHead rowSpan={2}>选择</TableHead>
                        <TableHead rowSpan={2}>经销商</TableHead>
                        <TableHead rowSpan={2}>SD / RSM</TableHead>
                        <TableHead rowSpan={2}>状态</TableHead>
                        <TableHead
                          colSpan={4}
                          className="v19-scope-group-annual"
                        >
                          2025 全年 Actual
                        </TableHead>
                        <TableHead colSpan={4} className="v19-scope-group-ytd">
                          2026 YTD Actual
                        </TableHead>
                        <TableHead colSpan={2} className="v19-scope-group-yoy">
                          YoY 2025 vs 2024
                        </TableHead>
                        <TableHead
                          colSpan={4}
                          className="v19-scope-group-investment"
                        >
                          历史投资 · 已选名单
                        </TableHead>
                        <TableHead rowSpan={2}>本人其他 Initiative</TableHead>
                      </TableRow>
                      <TableRow>
                        {["2025", "2026Ytd"].map((period) =>
                          ["Vol（KL）", "C3（K$）", "Phasing", "Yield"].map(
                            (label) => (
                              <TableHead className="num" key={period + label}>
                                {label}
                              </TableHead>
                            ),
                          ),
                        )}
                        <TableHead className="num">Vol</TableHead>
                        <TableHead className="num">C3</TableHead>
                        <TableHead className="num">
                          2025 投资（千美元）
                        </TableHead>
                        <TableHead className="num">2025 资源占比</TableHead>
                        <TableHead className="num">
                          2026 YTD 投资（千美元）
                        </TableHead>
                        <TableHead className="num">2026 YTD 资源占比</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {scopeDealers
                        .slice((scopePage - 1) * 20, scopePage * 20)
                        .map((dealer) => {
                          const h = dealer.history || {},
                            selected = i.rows.find(
                              (row) => row.dealerId === dealer.id,
                            );
                          return (
                            <TableRow key={dealer.id}>
                              <TableCell>
                                <Checkbox
                                  aria-label={`选择 ${dealerLabel(dealer.id)}`}
                                  checked={!!selected}
                                  disabled={
                                    !editable ||
                                    (!isActiveDealer(dealer) && !selected)
                                  }
                                  onCheckedChange={(checked) =>
                                    doGuard(() => {
                                      if (!(selected?.amount > 0 && !checked))
                                        rememberSelectionViewport();
                                      if (checked && !selected)
                                        update({
                                          rows: [
                                            ...i.rows,
                                            {
                                              dealerId: dealer.id,
                                              amount: 0,
                                              note: "",
                                            },
                                          ],
                                        });
                                      else if (!checked && selected?.amount > 0)
                                        setModal({
                                          type: "remove",
                                          dealerId: dealer.id,
                                          amount: selected.amount,
                                        });
                                      else if (!checked)
                                        update({
                                          rows: i.rows.filter(
                                            (row) => row.dealerId !== dealer.id,
                                          ),
                                        });
                                    })
                                  }
                                />
                              </TableCell>
                              <TableCell>
                                <Button
                                  variant="link"
                                  onClick={() =>
                                    setDetail({
                                      type: "dealer",
                                      dealerId: String(dealer.id),
                                      sector: i.sector,
                                      period: historyPeriod,
                                      basis: "c3",
                                      directoryOnly: true,
                                    })
                                  }
                                >
                                  {dealer.name || "—"}
                                </Button>
                                <small>{dealerCode(dealer.id)}</small>
                              </TableCell>
                              <TableCell>
                                {dealer.sd || "—"} / {dealer.rsm || "—"}
                              </TableCell>
                              <TableCell>
                                <Badge variant="secondary">
                                  {dealer.status || "—"}
                                </Badge>
                              </TableCell>
                              {["2025", "2026Ytd"].map((period) => (
                                <Fragment key={period}>
                                  <TableCell className="num">
                                    {histFmt(
                                      h[
                                        period === "2025"
                                          ? "vol2025"
                                          : "vol2026Ytd"
                                      ],
                                    )}
                                  </TableCell>
                                  <TableCell className="num">
                                    {histFmt(
                                      h[
                                        period === "2025"
                                          ? "c32025"
                                          : "c32026Ytd"
                                      ],
                                    )}
                                  </TableCell>
                                  <TableCell
                                    className="num"
                                    title="Phasing = Delivery Vol ÷ 对应期间经销商目标；目标须大于 0"
                                  >
                                    {historyPhasing(h, period) == null
                                      ? "—"
                                      : `${fmt(historyPhasing(h, period) * 100)}%`}
                                  </TableCell>
                                  <TableCell className="num">
                                    {historyYield(h, period) == null
                                      ? "—"
                                      : `${fmt(historyYield(h, period))}`}
                                  </TableCell>
                                </Fragment>
                              ))}
                              <TableCell className="num">
                                {historyYoyLabel(h, "vol")}
                              </TableCell>
                              <TableCell className="num">
                                {historyYoyLabel(h, "c3")}
                              </TableCell>
                              {["2025", "2026Ytd"].map((period) => (
                                <Fragment key={period}>
                                  <TableCell className="num">
                                    {histFmt(historyInvestment(h, period))}
                                  </TableCell>
                                  <TableCell className="num">
                                    {investmentShareFor(dealer.id, period) ==
                                    null
                                      ? "—"
                                      : `${fmt(investmentShareFor(dealer.id, period))}%`}
                                  </TableCell>
                                </Fragment>
                              ))}
                              <TableCell>
                                <Button
                                  variant="link"
                                  disabled={!otherInitiatives(dealer.id).length}
                                  onClick={() =>
                                    setDetail({
                                      type: "dealer",
                                      dealerId: String(dealer.id),
                                      sector: i.sector,
                                      period: historyPeriod,
                                      basis: "c3",
                                      ownerOthers: true,
                                      title:
                                        "本人其他 Initiative · " + dealer.name,
                                    })
                                  }
                                >
                                  {otherInitiatives(dealer.id).length
                                    ? `${otherInitiatives(dealer.id).length} 项 · ${fmt(otherInitiatives(dealer.id).reduce((sum, entry) => sum + entry.row.amount, 0) / 10000)} 万`
                                    : "—"}
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                    </TableBody>
                  </Table>
                </div>
                <div className="table-footer">
                  <span>显示 {scopeDealers.length} 家 · 每页 20 行</span>
                  <div className="actions">
                    <Button
                      variant="outline"
                      className="button small"
                      disabled={scopePage === 1}
                      onClick={() => setScopePage((page) => page - 1)}
                    >
                      上一页
                    </Button>
                    <span>
                      {scopePage} /{" "}
                      {Math.max(1, Math.ceil(scopeDealers.length / 20))}
                    </span>
                    <Button
                      variant="outline"
                      className="button small"
                      disabled={
                        scopePage >= Math.ceil(scopeDealers.length / 20)
                      }
                      onClick={() => setScopePage((page) => page + 1)}
                    >
                      下一页
                    </Button>
                  </div>
                </div>
              </Card>
            </>
          )}
          {activeStep === 3 && (
            <Card className="panel studio-trial-panel">
              <div className="panel-header">
                <div>
                  <h2>试算方案</h2>
                  <p className="small-text muted">
                    采用试算会覆盖当前金额，保留名单与主动预留；确认前显示预览。
                  </p>
                </div>
              </div>
              <HistoryControls
                ytdCutoffMonth={state.ytdCutoffMonth}
                period={trialPeriod}
                onPeriodChange={setTrialPeriod}
                metric={historyMetric}
                onMetricChange={setHistoryMetric}
              />
              <div className="v19-trial-tools">
                <strong>快捷方案选择</strong>
                {[
                  ["按Actual Delivery Vol采用", "vol"],
                  ["按Actual C3采用", "c3"],
                  ["按历史投资总额采用", "investment"],
                ].map(([label, metric]) => (
                  <Button
                    key={metric}
                    variant="outline"
                    disabled={!editable || !i.rows.length}
                    onClick={() => historyFill(metric, trialPeriod)}
                  >
                    {label}
                  </Button>
                ))}
                <Button
                  disabled={!i.rows.length}
                  onClick={() => setTrialCompare(true)}
                >
                  ⇄ 对比三种试算方案
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    setDetail({
                      type: "rationale",
                      initiativeId: i.id,
                      period: trialPeriod,
                      basis: historyMetric === "vol" ? "vol" : "c3",
                    })
                  }
                >
                  查看拆分依据与说明
                </Button>
              </div>
              {trialCompare && (
                <EditorDialog
                  title="对比三种试算方案"
                  close={() => setTrialCompare(false)}
                  action={null}
                >
                  <HistoryControls
                    ytdCutoffMonth={state.ytdCutoffMonth}
                    period={trialPeriod}
                    onPeriodChange={setTrialPeriod}
                    metric={historyMetric}
                    onMetricChange={setHistoryMetric}
                  />
                  <div className="studio-trial-grid">
                    {[
                      ["Delivery Vol", "vol", "按历史规模拆分"],
                      ["C3", "c3", "按历史贡献拆分"],
                      ["历史投资", "investment", "按四类历史投资合计拆分"],
                    ].map(([label, metric, note]) => {
                      let trial = null;
                      try {
                        trial = allocateByHistory(
                          i.rows,
                          dealers,
                          E.cents(i.budget - totals.otherBudget),
                          allocationHistoryField(metric, trialPeriod),
                          i.sector,
                          directoryDealers,
                        );
                      } catch (_) {
                        /* The card explains unavailable data through a disabled action. */
                      }
                      const impact = trial?.hasHistory
                        ? concentration(
                            portfolioRows(
                              [{ ...i, rows: trial.rows }],
                              dealers,
                              historyMetric === "vol" ? "vol" : "c3",
                              trialPeriod,
                            ),
                            20,
                          )
                        : null;
                      return (
                        <article key={metric}>
                          <span>试算</span>
                          <h3>{label}</h3>
                          <p>{note}</p>
                          <strong>
                            {i.rows.length} 家 ·{" "}
                            {fmt(Math.max(0, i.budget - totals.otherBudget))} 元
                          </strong>
                          <p>
                            {trial?.hasHistory
                              ? `${trial.rows.filter((row) => row.amount > 0).length} 家获配 · ${trial.unavailable.length} 家无有效历史`
                              : "缺少有效历史，暂不可采用"}
                          </p>
                          <p>
                            Top 20% 投资 /{" "}
                            {historyMetric === "vol" ? "Delivery Vol" : "C3"}{" "}
                            偏离：
                            {impact ? `${impact.gap.toFixed(1)} pp` : "—"}
                          </p>
                          <Button
                            variant="outline"
                            disabled={!trial?.hasHistory}
                            onClick={() => {
                              setTrialCompare(false);
                              setDetail({
                                type: "initiative",
                                initiativeId: i.id,
                                period: trialPeriod,
                                basis: historyMetric === "vol" ? "vol" : "c3",
                                previewRows: trial.rows,
                                title: `${label}试算预览 · 尚未采用`,
                              });
                            }}
                          >
                            查看经销商试算明细
                          </Button>
                          <Button
                            variant="default"
                            className="button primary small"
                            disabled={
                              !trial?.hasHistory ||
                              !editable ||
                              !i.rows.length ||
                              (metric === "investment" &&
                                !i.rows.some(
                                  (row) =>
                                    historyInvestment(
                                      dealerMeta(row.dealerId).history,
                                      trialPeriod,
                                    ) > 0,
                                ))
                            }
                            title={
                              metric === "investment"
                                ? "使用公共历史投资合计；缺少对应期间数据时不能试算"
                                : undefined
                            }
                            onClick={() => {
                              setTrialCompare(false);
                              setHistoryMetric(metric);
                              historyFill(metric, trialPeriod);
                            }}
                          >
                            采用此试算
                          </Button>
                        </article>
                      );
                    })}
                  </div>
                </EditorDialog>
              )}
              <div className="actions">
                <Button
                  variant="outline"
                  className="button small"
                  disabled={
                    !editable || busy || !state.planningVersion?.sourceVersionId
                  }
                  onClick={restoreSource}
                >
                  复制来源版已提交方案
                </Button>
                <Button
                  variant="outline"
                  className="button small"
                  disabled={!editable || !undo}
                  onClick={() =>
                    setModal({ type: "restore", title: "撤销上一步", ...undo })
                  }
                >
                  撤销上一步
                </Button>
                <Button
                  variant="outline"
                  className="button small"
                  onClick={() => setModal({ type: "history" })}
                >
                  查看本项目提交历史
                </Button>
              </div>
            </Card>
          )}
          {activeStep === 3 && (
            <SdAnalysis
              variant="editor"
              ytdCutoffMonth={state.ytdCutoffMonth}
              items={[i]}
              dealers={dealers}
              metadata={state.reference}
              threshold={state.healthThresholds?.dealerYellow ?? 3}
              sourceVersionId={state.planningVersion?.sourceVersionId}
              comparisonIdentity={identity.email}
            />
          )}
          {activeStep === 3 && (
            <Card className="panel">
              <div className="panel-header">
                <h2>经销商分配明细</h2>
                {editable && (
                  <div className="actions">
                    <Button
                      variant="outline"
                      className="button small"
                      disabled={busy}
                      onClick={() => download()}
                    >
                      ↓ 完整金额Excel
                    </Button>
                    <Button
                      variant="outline"
                      className="button small"
                      disabled={busy}
                      onClick={() => doGuard(() => fileRef.current.click())}
                    >
                      {busy ? "正在处理…" : "↑ 上传完整方案"}
                    </Button>
                    <Input
                      ref={fileRef}
                      type="file"
                      accept=".xlsx"
                      hidden
                      aria-label="上传分配 Excel"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        importFile(file);
                      }}
                    />
                    <Button
                      variant="outline"
                      className="button small"
                      disabled={!balanceIds.length || totals.gap === 0}
                      onClick={() => {
                        const rows = balanceSelectedDealers(
                          i.rows,
                          balanceIds,
                          totals.gap,
                        );
                        if (!Number.isInteger(totals.gap))
                          return notify(
                            "指定经销商配平要求待分配为整数元。",
                            true,
                          );
                        if (!rows)
                          return notify(
                            "请选择经销商，且配平后任何一家金额不能为负。",
                            true,
                          );
                        setModal({
                          type: "balance",
                          rows,
                          pending: totals.gap,
                        });
                      }}
                    >
                      指定经销商配平
                    </Button>
                  </div>
                )}
              </div>
              <HistoryControls
                ytdCutoffMonth={state.ytdCutoffMonth}
                period={historyPeriod}
                onPeriodChange={setHistoryPeriod}
                metric={historyMetric}
                onMetricChange={setHistoryMetric}
              />
              {editable && (
                <p className="work-caption">
                  经销商列表已包含在下载模板的「经销商列表」工作表中，业务线为第一列。
                </p>
              )}
              <div className="v19-allocation-filters">
                <Input
                  type="search"
                  value={allocationQuery}
                  onChange={(event) => {
                    setAllocationQuery(event.target.value);
                    setAllocationPage(1);
                  }}
                  placeholder="搜索经销商 / 编码 / SD / RSM"
                  aria-label="查找经销商分配"
                />
                <Label>
                  <Checkbox
                    checked={allocatedOnly}
                    onCheckedChange={(checked) => {
                      setAllocatedOnly(checked === true);
                      setAllocationPage(1);
                    }}
                  />
                  只看已获配
                </Label>
              </div>
              <div className="v19-ratio-legend">
                <span title="Phasing = 实际 Delivery Vol 合计 ÷ 对应期间经销商目标合计；任一数据缺失时不计算。">
                  加权平均 Phasing{" "}
                  <b>
                    {weightedPhasing == null
                      ? "—"
                      : `${fmt(weightedPhasing * 100)}%`}{" "}
                    ↑
                  </b>
                </span>
                <span title="Yield = 名单 C3（美元）合计 ÷ 同期间历史投资（美元）合计，历史投资已按配置汇率统一为美元；不平均各家比率，数据不完整或 YTD 覆盖未知时显示 —。">
                  加权平均 Yield{" "}
                  <b>
                    {weightedYield == null
                      ? "—"
                      : `${weightedYield.toFixed(2)}`}{" "}
                    ↑
                  </b>
                </span>
                <span className="good">优于平均</span>
                <span className="mid">±10%近均</span>
                <span className="bad">需关注</span>
              </div>
              <div className="v19-table-jumps">
                <span>快速定位列组</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => jumpAllocation("investment")}
                >
                  历史投资 / Yield
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => jumpAllocation("share")}
                >
                  占比与差值
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => jumpAllocation("contract")}
                >
                  合同 / Actual
                </Button>
              </div>
              <div
                ref={allocationScroll}
                className="table-scroll allocation-scroll"
                tabIndex={0}
                role="region"
                aria-label="经销商分配明细，可上下和横向滚动"
              >
                <Table
                  containerClassName="overflow-visible"
                  className="allocation-table v19-allocation-table"
                  data-editable={editable}
                >
                  <TableHeader>
                    <TableRow>
                      {allocationGroups.map((group) => (
                        <TableHead
                          key={group.key}
                          scope="colgroup"
                          colSpan={
                            group.columns.length +
                            (editable && ["plan", "support"].includes(group.key)
                              ? 1
                              : 0)
                          }
                          className={`v19-group-${group.key}`}
                          data-v19-column-group={group.key}
                        >
                          {group.title}
                        </TableHead>
                      ))}
                    </TableRow>
                    <TableRow>
                      {editable && (
                        <TableHead scope="col" aria-label="选择配平经销商">选择</TableHead>
                      )}
                      {allocationColumns.map(([key, title]) => key === "support" ? (
                        <TableHead key={key} data-column={key} scope="col">
                          {title}
                        </TableHead>
                      ) : (
                        <SortHead
                          key={key}
                          scope="col"
                          sort={allocationSort}
                          onSort={sortAllocation}
                          sortKey={key}
                          data-column={key}
                          className={
                            ["name", "sd", "rsm", "note"].includes(
                              key,
                            )
                              ? ""
                              : "num"
                          }
                        >
                          {title}
                        </SortHead>
                      ))}
                      {editable && <TableHead scope="col">操作</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayedAllocationRows.map((r) => {
                      const rowIndex = i.rows.findIndex(
                          (row) => row.dealerId === r.dealerId,
                        ),
                        dealer = dealerMeta(r.dealerId),
                        awards = awardsByDealer.get(String(r.dealerId)) || [];
                      return (
                        <TableRow key={r.dealerId}>
                          {editable && (
                            <TableCell>
                              <Checkbox
                                aria-label={`选择 ${dealerLabel(r.dealerId)} 参与配平`}
                                checked={balanceIds.includes(r.dealerId)}
                                onCheckedChange={() =>
                                  setBalanceIds((current) =>
                                    toggleDealerSelection(current, r.dealerId),
                                  )
                                }
                              />
                            </TableCell>
                          )}
                          {allocationColumns.map(([key]) => (
                            <TableCell
                              key={key}
                              data-column={key}
                              className={
                                key === "name"
                                  ? "v19-dealer-name"
                                  : key === "amount"
                                    ? "num v19-money-cell"
                                    : key === "note"
                                      ? "allocation-note"
                                      : ["sd", "rsm", "support"].includes(key)
                                        ? ""
                                        : "num"
                              }
                            >
                              {key === "name" ? (
                                <>
                                  <Button
                                    variant="link"
                                    onClick={() =>
                                      setDetail({
                                        type: "dealer",
                                        dealerId: String(r.dealerId),
                                        sector: i.sector,
                                        period: historyPeriod,
                                        basis:
                                          historyMetric === "vol"
                                            ? "vol"
                                            : "c3",
                                      })
                                    }
                                  >
                                    {dealerName(r.dealerId)}
                                  </Button>
                                  <small>
                                    {dealerCode(r.dealerId)} ·{" "}
                                    {dealer.status || "—"}
                                  </small>
                                </>
                              ) : key === "amount" ? (
                                editable ? (
                                  <AmountInput
                                    value={r.amount}
                                    label={
                                      dealerLabel(r.dealerId) + " 分配金额"
                                    }
                                    save={(value) => changeRow(rowIndex, value)}
                                  />
                                ) : (
                                  fmt(r.amount)
                                )
                              ) : key === "yield" ? (
                                <RatioIndicator
                                  value={allocationValue(r, key)}
                                  average={weightedYield}
                                />
                              ) : key === "support" ? (
                                awards.length ? (
                                  <div className="v20-allocation-awards">
                                    {awards.map((item) => (
                                      <Button
                                        key={item.id}
                                        variant="outline"
                                        size="sm"
                                        title={item.name}
                                        data-awarded-initiative={item.id}
                                        onClick={() =>
                                          setDetail({
                                            type: "initiative",
                                            initiativeId: item.id,
                                            awardedProject: true,
                                            dealerId: String(r.dealerId),
                                            scopeDealerKeys: [`${i.sector}:${r.dealerId}`],
                                            period: historyPeriod,
                                            basis: historyMetric === "vol" ? "vol" : "c3",
                                          })
                                        }
                                      >
                                        {item.name}
                                      </Button>
                                    ))}
                                  </div>
                                ) : "—"
                              ) : key === "note" ? (
                                editable ? (
                                  <Input
                                    value={r.note || ""}
                                    aria-label={`${dealerLabel(r.dealerId)} 调整说明`}
                                    onChange={(event) =>
                                      update({
                                        rows: i.rows.map((row, index) =>
                                          index === rowIndex
                                            ? {
                                                ...row,
                                                note: event.target.value,
                                              }
                                            : row,
                                        ),
                                      })
                                    }
                                  />
                                ) : (
                                  r.note || "—"
                                )
                              ) : (
                                allocationFormat(allocationValue(r, key), key)
                              )}
                            </TableCell>
                          ))}
                          {editable && (
                            <TableCell>
                              <Button
                                variant="ghost"
                                aria-label={
                                  "移除经销商 " + dealerLabel(r.dealerId)
                                }
                                onClick={() =>
                                  doGuard(() =>
                                    setModal({
                                      type: "remove",
                                      dealerId: r.dealerId,
                                      amount: r.amount,
                                    }),
                                  )
                                }
                              >
                                移除
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                    {!displayedAllocationRows.length && (
                      <TableRow>
                        <TableCell
                          colSpan={
                            allocationColumns.length + (editable ? 2 : 0)
                          }
                          className="empty"
                        >
                          暂无匹配经销商
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      {editable && <TableCell />}
                      {allocationColumns.map(([key], index) => (
                        <TableCell
                          key={key}
                          data-column={key}
                          className={
                            key === "amount" ? "num v19-money-cell" : "num"
                          }
                        >
                          {index === 0
                            ? "范围合计 / 加权值"
                            : ["sd", "rsm", "support", "note"].includes(key)
                              ? ""
                              : allocationFormat(
                                  totalAllocationValue(key),
                                  key,
                                )}
                        </TableCell>
                      ))}
                      {editable && <TableCell />}
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
              <div className="v19-allocation-pagination">
                <span>
                  显示 {allocationFiltered.length} / {i.rows.length} 家 ·
                  占比与加权值按完整名单计算
                </span>
                <div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentAllocationPage <= 1}
                    onClick={() => setAllocationPage(currentAllocationPage - 1)}
                  >
                    上一页
                  </Button>
                  <span>
                    {currentAllocationPage} / {allocationPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentAllocationPage >= allocationPages}
                    onClick={() => setAllocationPage(currentAllocationPage + 1)}
                  >
                    下一页
                  </Button>
                </div>
              </div>
              <div className="table-footer">
                <span>
                  {editable
                    ? apiMode
                      ? "输入金额或比例 · 编辑后请保存草稿"
                      : "输入金额或比例 · 修改即时保存"
                    : "经销商分配明细 · 只读"}
                </span>
                {editable && (
                  <div className="actions">
                    <Button
                      variant="link"
                      className="button link"
                      disabled={busy}
                      onClick={() => download(true)}
                    >
                      下载经销商
                    </Button>
                    <Button
                      variant="link"
                      className="button link"
                      onClick={() =>
                        doGuard(() => {
                          setNewDealers([]);
                          setDealerCodeSearch("");
                          setDealerNameSearch("");
                          setModal({ type: "add" });
                        })
                      }
                    >
                      + 添加经销商
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          )}
          {activeStep === 1 && (
            <Card className="panel other-budget-panel">
              <div className="panel-header">
                <div>
                  <h2>多笔预留 · 原因与金额</h2>
                  <p className="small-text muted">
                    按原因逐项登记，可添加多行；金额纳入本项预算平衡。
                  </p>
                </div>
              </div>
              <div className="table-scroll">
                <Table
                  containerClassName="overflow-visible"
                  className="other-budget-table"
                >
                  <TableHeader>
                    <TableRow>
                      <TableHead>原因 / 用途</TableHead>
                      <TableHead className="num">金额（元）</TableHead>
                      {editable && <TableHead>操作</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {i.otherBudgets.map((r, n) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          {editable ? (
                            <NativeSelect
                              aria-label={`第 ${n + 1} 项安排原因类型`}
                              value={r.reasonId}
                              onChange={(e) =>
                                changeOther(n, "reasonId", e.target.value)
                              }
                            >
                              {state.budgetReasons
                                .filter(
                                  (reason) =>
                                    reason.enabled || reason.id === r.reasonId,
                                )
                                .map((reason) => (
                                  <NativeSelectOption
                                    key={reason.id}
                                    value={reason.id}
                                    disabled={!reason.enabled}
                                  >
                                    {reason.label}
                                    {!reason.enabled && "（已停用）"}
                                  </NativeSelectOption>
                                ))}
                            </NativeSelect>
                          ) : (
                            state.budgetReasons.find(
                              (reason) => reason.id === r.reasonId,
                            )?.label || r.reasonId
                          )}
                          {!i.workflow &&
                            (editable ? (
                              <Input
                                aria-label={`第 ${n + 1} 项安排具体原因`}
                                placeholder="填写具体原因或用途"
                                value={r.note}
                                onChange={(event) =>
                                  changeOther(n, "note", event.target.value)
                                }
                              />
                            ) : (
                              <small>{r.note || "—"}</small>
                            ))}
                        </TableCell>
                        <TableCell className="num">
                          {editable ? (
                            <AmountInput
                              label={`第 ${n + 1} 项安排金额`}
                              value={r.amount}
                              save={(v) => changeOther(n, "amount", v)}
                            />
                          ) : (
                            fmt(r.amount)
                          )}
                        </TableCell>
                        {editable && (
                          <TableCell>
                            <Button
                              variant="ghost"
                              className="button subtle small"
                              aria-label={`移除第 ${n + 1} 项预算安排`}
                              onClick={() =>
                                doGuard(() =>
                                  update({
                                    otherBudgets: i.otherBudgets.filter(
                                      (_, index) => index !== n,
                                    ),
                                  }),
                                )
                              }
                            >
                              移除
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                    {editable ? (
                      <TableRow>
                        <TableCell colSpan={3}>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={addReserve}
                          >
                            ＋ 添加预留
                          </Button>
                        </TableCell>
                      </TableRow>
                    ) : (
                      !i.otherBudgets.length && (
                        <TableRow>
                          <TableCell colSpan={2}>暂无预留安排。</TableCell>
                        </TableRow>
                      )
                    )}
                  </TableBody>
                </Table>
              </div>
              <div className="v19-reserve-intro">
                <strong>先定义预留，再拆分能明确到经销商的预算。</strong>{" "}
                暂不能明确对象或用途的部分，请设置预留并说明原因。允许有原因的100%预留，不为了配平强行分摊。预留不会因手工微调自动消耗。
              </div>
            </Card>
          )}
          {activeStep === 1 && (
            <Card className="panel v20-reserve-review">
              <Label>
                <Checkbox
                  aria-label="已核对本版预算与预留，明确本次分配范围"
                  checked={!editable || reserveConfirmed}
                  disabled={!editable}
                  onCheckedChange={(checked) =>
                    acknowledgeReserve(checked === true)
                  }
                />
                已核对本版预算与预留，明确本次分配范围
              </Label>
              <p>
                {editable
                  ? "勾选后可进入经销商名单和试算。预算、预留金额或原因改变后，需要重新核对。"
                  : "已提交或只读方案可浏览，不要求重新确认。"}
              </p>
            </Card>
          )}
          {activeStep === 1 && (
            <Card className="panel v19-adjustment-reason">
              <h2>调整依据说明</h2>
              <Input
                aria-label="调整依据说明"
                maxLength="160"
                disabled={!editable}
                value={changeReason}
                onChange={(event) => setChangeReason(event.target.value)}
                placeholder="说明本版名单、金额或预留变化原因"
              />
            </Card>
          )}
          {activeStep === 3 &&
            (errors.length ? (
              <Alert className="note-box warn">
                <AlertDescription>
                  {errors.map((e) => (
                    <div key={e}>{e.replace("标记完成", "提交当前方案")}</div>
                  ))}
                </AlertDescription>
              </Alert>
            ) : (
              <Alert className="note-box success">
                <AlertDescription>
                  {i.workflow
                    ? i.workflow.submitted
                      ? "当前方案已提交，进入只读。"
                      : "分配与预算平衡；提交后进入只读，退回后才可重新编辑。"
                    : "分配与预算平衡，可以提交。"}
                </AlertDescription>
              </Alert>
            ))}
          <div className="save-bar v19-sticky-actions">
            <Button
              variant="outline"
              onClick={() =>
                activeStep === 1
                  ? doGuard(() =>
                      navigate(
                        identity.role === "owner" ? "home" : "department",
                      ),
                    )
                  : setActiveStep(activeStep - 1)
              }
            >
              {activeStep === 1 ? "← 返回项目" : "← 上一步"}
            </Button>
            <div className="save-label">
              <strong>
                {apiMode
                  ? hasUnsavedChanges
                    ? "本页修改尚未保存"
                    : savedForSync
                      ? "草稿已保存，可以提交"
                      : synchronizedRevision
                        ? "当前修订已提交"
                        : "请先保存草稿后再提交"
                  : "有效修改自动保存到本机"}
              </strong>{" "}
              · {time(i.savedAt)}
            </div>
            {editable && (
              <div className="actions">
                <Button
                  variant="outline"
                  className="button"
                  disabled={operation !== null}
                  onClick={handleSaveDraft}
                >
                  {operation === "save" ? "正在保存…" : "保存草稿"}
                </Button>
                {activeStep < 3 ? (
                  <Button
                    disabled={
                      !canEnterAllocationStep(
                        activeStep + 1,
                        editable,
                        reserveConfirmed,
                      )
                    }
                    onClick={() => doGuard(() => chooseStep(activeStep + 1))}
                  >
                    下一步 →
                  </Button>
                ) : (
                  <Button
                    variant="default"
                    className="button primary"
                    disabled={!canSynchronize}
                    title={
                      !savedForSync || hasUnsavedChanges
                        ? "请先保存草稿，再提交当前方案"
                        : errors.length > 0
                          ? "请先修正当前分配问题"
                          : undefined
                    }
                    onClick={handlePublish}
                  >
                    {operation === "publish"
                      ? "正在提交…"
                      : `提交到 ${state.planningVersion?.id || "当前版本"} →`}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
        {detail && (
          <ResourceDetailDrawer
            detail={detail}
            items={detailItems}
            dealers={dealers}
            ytdCutoffMonth={state.ytdCutoffMonth}
            budgetReasons={state.budgetReasons}
            onClose={() => setDetail(null)}
          />
        )}
        {modal && (
          <EditorDialog
            title={
              modal.title ||
              {
                add: "添加经销商",
                remove: "移除经销商分配",
                fill: "按历史占比辅助填充",
                balance: "指定经销商配平",
                import: "Excel 导入预览",
                history: "单项同步历史",
                other: "本人其他 Initiative",
              }[modal.type]
            }
            close={close}
            action={
              modal.type === "restore" ? (
                <Button
                  variant="default"
                  className="button primary"
                  onClick={() => {
                    if (
                      update({
                        rows: modal.rows,
                        otherBudgets: modal.otherBudgets,
                      })
                    ) {
                      setChangeReason("");
                      close();
                    }
                  }}
                >
                  确认采用
                </Button>
              ) : modal.type === "add" ? (
                <Button
                  variant="default"
                  className="button primary"
                  disabled={!newDealers.length}
                  onClick={() => {
                    if (
                      update({
                        rows: [
                          ...i.rows,
                          ...newDealers.map((dealerId) => ({
                            dealerId,
                            amount: 0,
                            note: "",
                          })),
                        ],
                      })
                    )
                      close();
                  }}
                >
                  确认添加
                </Button>
              ) : modal.type === "remove" ? (
                <Button
                  variant="destructive"
                  className="button danger"
                  onClick={() => {
                    if (
                      update({
                        rows: i.rows.filter(
                          (r) => r.dealerId !== modal.dealerId,
                        ),
                      })
                    )
                      close();
                  }}
                >
                  确认移除
                </Button>
              ) : modal.type === "fill" ? (
                <Button
                  variant="default"
                  className="button primary"
                  disabled={!modal.hasHistory}
                  onClick={() => {
                    if (!modal.hasHistory)
                      return notify("历史权重合计为 0，不能应用试算。", true);
                    if (i.revision !== modal.revision)
                      return notify("工作稿已变化，请重新预览。", true);
                    if (update({ rows: modal.rows })) close();
                  }}
                >
                  应用本次填充
                </Button>
              ) : modal.type === "balance" ? (
                <Button
                  variant="default"
                  className="button primary"
                  onClick={() => {
                    if (update({ rows: modal.rows })) {
                      setBalanceIds([]);
                      close();
                    }
                  }}
                >
                  确认配平
                </Button>
              ) : modal.type === "import" ? (
                <Button
                  variant="default"
                  className="button primary"
                  disabled={modal.preview.errors.length > 0}
                  onClick={async () => {
                    const values = {
                      rows: modal.preview.rows,
                      otherBudgets: modal.preview.otherBudgets,
                    };
                    if (await saveDraft(i.id, values, modal.preview.revision))
                      close();
                  }}
                >
                  确认写入
                </Button>
              ) : null
            }
          >
            {modal.type === "other" && (
              <>
                <p>
                  {dealerLabel(modal.dealerId)} ·
                  仅列出本人其他项目的当前草稿投入。
                </p>
                <div className="table-scroll">
                  <Table containerClassName="overflow-visible">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Initiative</TableHead>
                        <TableHead>资源大类</TableHead>
                        <TableHead>金额</TableHead>
                        <TableHead>本项目投资占比</TableHead>
                        <TableHead>说明</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {otherInitiatives(modal.dealerId)
                        .sort((a, b) => b.row.amount - a.row.amount)
                        .map(({ item, row }) => (
                          <TableRow key={item.id}>
                            <TableCell>
                              <Button
                                variant="link"
                                className="button link"
                                onClick={() => {
                                  close();
                                  navigate("editor", item.id);
                                }}
                              >
                                {item.name}
                              </Button>
                            </TableCell>
                            <TableCell>{item.resourceType}</TableCell>
                            <TableCell>{fmt(row.amount)}</TableCell>
                            <TableCell>
                              {pct(row.amount, E.totals([item]).allocated)}%
                            </TableCell>
                            <TableCell>{row.note || "—"}</TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
            {modal.type === "restore" && (
              <>
                <p>
                  将恢复 {modal.rows.length}{" "}
                  家经销商及对应金额、预留和逐家说明，金额不会按本版预算自动缩放；本次调整原因需重新填写。
                </p>
                <p>
                  经销商分配合计{" "}
                  {fmt(modal.rows.reduce((sum, row) => sum + row.amount, 0))} 元
                  · 预留{" "}
                  {fmt(
                    modal.otherBudgets.reduce(
                      (sum, row) => sum + row.amount,
                      0,
                    ),
                  )}{" "}
                  元
                </p>
              </>
            )}
            {modal.type === "add" && (
              <>
                <div className="dealer-search-grid">
                  <Label className="form-field">
                    经销商编码
                    <Input
                      type="search"
                      autoFocus
                      value={dealerCodeSearch}
                      placeholder="模糊搜索经销商编码"
                      onChange={(e) => setDealerCodeSearch(e.target.value)}
                    />
                  </Label>
                  <Label className="form-field">
                    经销商名称
                    <Input
                      type="search"
                      value={dealerNameSearch}
                      placeholder="模糊搜索经销商名称"
                      onChange={(e) => setDealerNameSearch(e.target.value)}
                    />
                  </Label>
                </div>
                <div className="table-scroll">
                  <Table containerClassName="overflow-visible">
                    <TableHeader>
                      <TableRow>
                        <TableHead aria-label="选择经销商" />
                        <TableHead>业务线</TableHead>
                        <TableHead>经销商编码</TableHead>
                        <TableHead>经销商名称</TableHead>
                        <TableHead>SD</TableHead>
                        <TableHead>RSM</TableHead>
                        <TableHead>状态</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {searchedDealers.map((dealer) => (
                        <TableRow key={dealer.id}>
                          <TableCell>
                            <Checkbox
                              aria-label={`选择经销商 ${dealerLabel(dealer.id)}`}
                              checked={newDealers.includes(dealer.id)}
                              onCheckedChange={() =>
                                setNewDealers((current) =>
                                  toggleDealerSelection(current, dealer.id),
                                )
                              }
                            />
                          </TableCell>
                          <TableCell>{dealer.sector || "—"}</TableCell>
                          <TableCell>{dealerCode(dealer.id)}</TableCell>
                          <TableCell>{dealer.name || "—"}</TableCell>
                          <TableCell>{dealer.sd || "—"}</TableCell>
                          <TableCell>{dealer.rsm || "—"}</TableCell>
                          <TableCell>
                            <span
                              className={`resource-status ${dealer.status || ""}`}
                            >
                              {dealer.status || "—"}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                      {!searchedDealers.length && (
                        <TableRow>
                          <TableCell colSpan={7}>
                            {directoryStatus === "loading" ? (
                              "正在加载历史表经销商目录…"
                            ) : directoryStatus === "error" ? (
                              <>
                                经销商目录加载失败，请稍后重试。
                                <Button
                                  variant="ghost"
                                  className="button subtle small"
                                  onClick={() =>
                                    loadDistributorDirectory({ force: true })
                                  }
                                >
                                  重新加载
                                </Button>
                              </>
                            ) : available.length ? (
                              "没有匹配的经销商"
                            ) : (
                              "已无可添加经销商"
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
            {modal.type === "remove" && (
              <p>
                移除 {dealerLabel(modal.dealerId)} 的 {fmt(modal.amount)}{" "}
                分配后，金额将成为未解释差额，不会自动移到其他行。
              </p>
            )}
            {modal.type === "fill" && (
              <>
                <p>
                  以当前经销商范围的 {modal.metricLabel}
                  占比拆分预算，保留其他预算安排。此操作不代表投资推荐。
                </p>
                <MissingHistoryNotice
                  metricLabel={modal.metricLabel}
                  unavailable={modal.unavailable}
                  hasHistory={modal.hasHistory}
                />
                {!modal.rows.length && (
                  <p role="status">
                    尚未添加经销商，可分配预算保留为未分配差额。
                  </p>
                )}
                <div className="table-scroll">
                  <Table containerClassName="overflow-visible">
                    <TableHeader>
                      <TableRow>
                        <TableHead>经销商</TableHead>
                        <TableHead>当前金额</TableHead>
                        <TableHead>预览金额</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {modal.rows.map((r, n) => (
                        <TableRow key={r.dealerId}>
                          <TableCell>{dealerCode(r.dealerId)}</TableCell>
                          <TableCell>{fmt(i.rows[n].amount)}</TableCell>
                          <TableCell>{fmt(r.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
            {modal.type === "balance" && (
              <>
                <p>
                  待分配 {fmt(modal.pending)} 元将在已勾选的 {balanceIds.length}{" "}
                  家经销商之间均摊；余数按当前金额降序、编码升序逐家分配。
                </p>
                <div className="table-scroll">
                  <Table containerClassName="overflow-visible">
                    <TableHeader>
                      <TableRow>
                        <TableHead>经销商</TableHead>
                        <TableHead className="num">当前金额</TableHead>
                        <TableHead className="num">配平后</TableHead>
                        <TableHead className="num">变化</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {i.rows
                        .filter((row) => balanceIds.includes(row.dealerId))
                        .map((row) => {
                          const after = modal.rows.find(
                            (value) => value.dealerId === row.dealerId,
                          );
                          return (
                            <TableRow key={row.dealerId}>
                              <TableCell>{dealerCode(row.dealerId)}</TableCell>
                              <TableCell className="num">
                                {fmt(row.amount)}
                              </TableCell>
                              <TableCell className="num">
                                {fmt(after.amount)}
                              </TableCell>
                              <TableCell className="num">
                                {after.amount - row.amount >= 0 ? "+" : ""}
                                {fmt(after.amount - row.amount)}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                    </TableBody>
                  </Table>
                </div>
                <Alert className="note-box success">
                  <AlertDescription>
                    确认后待分配为 0；主动预留不参与本次配平。
                  </AlertDescription>
                </Alert>
              </>
            )}
            {modal.type === "import" && (
              <>
                <p>
                  {modal.name} ·{" "}
                  {modal.preview.errors.length
                    ? "存在错误，不能写入"
                    : "校验通过，确认后完整替换分配明细及其他预算安排"}
                </p>
                {modal.preview.errors.length > 0 && (
                  <ul className="import-errors">
                    {modal.preview.errors.map((error, n) => (
                      <li key={n}>{error}</li>
                    ))}
                  </ul>
                )}
                <Alert className="note-box">
                  <AlertDescription>
                    导入前安排 {fmt(modal.preview.summary.before)} · 导入后安排{" "}
                    {fmt(modal.preview.summary.after)} · 导入后差额{" "}
                    {fmt(modal.preview.summary.gap)}
                  </AlertDescription>
                </Alert>
                <div className="table-scroll">
                  <Table containerClassName="overflow-visible">
                    <TableHeader>
                      <TableRow>
                        <TableHead>经销商</TableHead>
                        <TableHead>导入前</TableHead>
                        <TableHead>导入后</TableHead>
                        <TableHead>变化</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {modal.preview.changes
                        .filter((c) => !c.otherBudgets)
                        .map((c) => (
                          <TableRow key={c.dealerId}>
                            <TableCell>{dealerLabel(c.dealerId)}</TableCell>
                            <TableCell>
                              {c.before ? fmt(c.before.amount) : "—"}
                            </TableCell>
                            <TableCell>
                              {c.after ? fmt(c.after.amount) : "—"}
                            </TableCell>
                            <TableCell>
                              {!c.before ? "新增" : !c.after ? "删除" : "修改"}
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </div>
                <h3>
                  其他预算安排 · {modal.preview.otherBudgets?.length || 0} 行
                </h3>
                <div className="table-scroll">
                  <Table containerClassName="overflow-visible">
                    <TableHeader>
                      <TableRow>
                        <TableHead>原因 / 用途</TableHead>
                        <TableHead>金额</TableHead>
                        <TableHead>具体原因</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {modal.preview.otherBudgets?.map((r, n) => (
                        <TableRow key={n}>
                          <TableCell>
                            {state.budgetReasons.find(
                              (reason) => reason.id === r.reasonId,
                            )?.label || r.reasonId}
                          </TableCell>
                          <TableCell>{fmt(r.amount)}</TableCell>
                          <TableCell>{r.note || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <Alert className="note-box">
                  <AlertDescription>
                    确认时再次校验身份、修订号与原因配置；未同步前不影响管理层数据。
                  </AlertDescription>
                </Alert>
              </>
            )}
            {modal.type === "history" && (
              <>
                {history.length ? (
                  [...history].reverse().map((record) => (
                    <Accordion key={record.id} type="single" collapsible>
                      <AccordionItem value={String(record.id)}>
                        <AccordionTrigger>
                          第 {record.number} 次同步 · {time(record.publishedAt)}{" "}
                          · 修订 {record.publishedRevision}
                        </AccordionTrigger>
                        <AccordionContent>
                          <p>
                            预算 {fmt(record.initiative.budget)} · 经销商分配{" "}
                            {fmt(E.totals([record.initiative]).allocated)} ·
                            参考批次 {record.reference.batchId}
                          </p>
                          <div className="table-scroll">
                            <Table containerClassName="overflow-visible">
                              <TableHeader>
                                <TableRow>
                                  <TableHead>经销商</TableHead>
                                  <TableHead>同步金额</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {record.initiative.rows.map((r) => (
                                  <TableRow key={r.dealerId}>
                                    <TableCell>
                                      {dealerCode(r.dealerId)}
                                    </TableCell>
                                    <TableCell>{fmt(r.amount)}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                          {record.initiative.otherBudgets?.map((r) => (
                            <p key={r.id}>
                              {state.budgetReasons.find(
                                (reason) => reason.id === r.reasonId,
                              )?.label || r.reasonId}{" "}
                              · {fmt(r.amount)} · {r.note}
                            </p>
                          ))}
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  ))
                ) : (
                  <div className="empty">
                    尚未提交。Owner 提交后进入部门确认，统一确认后管理层才可见。
                  </div>
                )}
              </>
            )}
          </EditorDialog>
        )}
      </div>
    </>
  );
}
import { validatePortalSession } from "../../portal/session";
import { assertPreviewResponseCurrent, getPreviewEpoch } from "../userPreview";
