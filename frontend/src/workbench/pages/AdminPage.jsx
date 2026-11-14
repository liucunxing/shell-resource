import { AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../../components/ui/dialog";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "../../components/ui/table";
import { Badge } from "../../components/ui/badge";
import { Textarea } from "../../components/ui/textarea";
import {
  NativeSelect,
  NativeSelectOption,
} from "../../components/ui/native-select";
import { useEffect, useRef, useState } from "react";
import { useWorkbench } from "../WorkbenchContext.jsx";
import E from "../domain/engine.js";
import AX from "../domain/admin-excel.js";
import { HistoricalResourceSettings } from "./HistoricalResourceSettings.jsx";
import {
  exportExcelInWorker,
  parseReferenceInWorker,
  previewExcelInWorker,
} from "../file-import.js";
import { AdminUsersPanel } from "./AdminUsersPanel.jsx";
import {
  AdminBudgetFields,
  budgetForm,
  budgetPayload,
} from "./AdminBudgetFields.jsx";

const money = (value) =>
  Number.isFinite(value)
    ? value.toLocaleString("zh-CN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : "无效值";
export function filterAdminInitiatives(items, query) {
  const term = String(query || "")
    .trim()
    .toLocaleLowerCase();
  return items.filter((item) =>
    String(item.name || "")
      .toLocaleLowerCase()
      .includes(term),
  );
}
const time = (value) => (value ? new Date(value).toLocaleString("zh-CN") : "—");
const tabs = [
  ["budgets", "预算与归属"],
  ["reasons", "预算原因配置"],
  ["reference", "参考数据批次"],
  ["permissions", "人员与权限"],
  ["guide", "分析指南"],
  ["audit", "变更记录"],
];
const actionNames = {
  edit_admin_budget: "编辑项目配置",
  delete_admin_budget: "删除项目",
  set_budget: "预算调整",
  import_admin_configuration: "预算与归属导入",
  change_reference: "参考批次发布",
  set_guide: "分析指南更新",
  generate_insight: "生成六点分析",
  set_owner: "Owner 映射调整",
  set_analysis_prompt: "分析提示词更新",
  set_budget_reasons: "预算原因更新",
  save_initiative: "保存工作稿",
  publish_initiative: "同步最新分配",
};

function AdminDialog({
  title,
  children,
  onClose,
  onConfirm,
  confirmLabel = "保存",
  disabled = false,
  error = "",
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-4xl max-h-[88dvh] overflow-y-auto"
        showCloseButton={false}
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="modal-body">{children}</div>
        <DialogFooter>
          <Button variant="outline" type="button" onClick={onClose}>
            {onConfirm ? "取消" : "关闭"}
          </Button>
          {onConfirm && (
            <Button type="button" disabled={disabled} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AdminPage() {
  const {
    state,
    view,
    identity,
    mutate,
    notify,
    apiMode,
    roles,
    saveAdminBudgets,
    manageAdminBudget,
    importAdminBudgets,
    saveConfig,
    saveReference,
    loading,
    previewMode,
  } = useWorkbench();
  const [tab, setTab] = useState("budgets");
  const [modal, setModal] = useState(null);
  const [value, setValue] = useState("");
  const [guide, setGuide] = useState(state.guide.text);
  const [busy, setBusy] = useState(false);
  const [savingBudgets, setSavingBudgets] = useState(false);
  const [budgetError, setBudgetError] = useState("");
  const [initiativeSearch, setInitiativeSearch] = useState("");
  useEffect(() => setBudgetError(""), [modal?.kind, modal?.item?.id]);
  const upload = useRef(null);
  const referenceUpload = useRef(null);
  const sequence = useRef(0);
  const saveSequence = useRef(0);
  const latest = useRef({ state, identity, tab });
  latest.current = { state, identity, tab };
  useEffect(
    () => () => {
      sequence.current += 1;
    },
    [],
  );
  useEffect(() => {
    setGuide(state.guide.text);
  }, [state.guide.text]);
  useEffect(() => {
    sequence.current += 1;
    saveSequence.current += 1;
    setModal(null);
    setBusy(false);
    setSavingBudgets(false);
  }, [identity]);
  const items = (typeof view === "function" ? view() : view).initiatives;
  const matchedItems = filterAdminInitiatives(items, initiativeSearch);
  const close = () => {
    sequence.current += 1;
    setModal(null);
    setBusy(false);
  };
  const change = (fn, message) => {
    if (mutate(fn, message)) close();
  };
  const edit = (kind, item, initial) => {
    setValue(String(initial));
    setModal({ kind, item });
  };
  const switchTab = (next) => {
    close();
    setTab(next);
  };
  const budgetPending = busy || savingBudgets || loading;

  async function saveBudgetOperation() {
    if (budgetPending) return;
    const { kind, item } = modal;
    setBudgetError("");
    try {
      const payload =
        kind === "delete" ? null : budgetPayload(modal.form, apiMode);
      if (kind !== "delete") {
        const candidate = structuredClone(state);
        if (kind === "edit")
          E.editAdminBudget(candidate, item.id, payload, identity, roles);
        else
          E.applyAdminConfiguration(candidate, [], identity, roles, [payload]);
      }
      if (!apiMode) {
        change((draft) => {
          if (kind === "delete") E.deleteAdminBudget(draft, item.id, identity);
          else if (kind === "edit")
            E.editAdminBudget(draft, item.id, payload, identity, roles);
          else E.applyAdminConfiguration(draft, [], identity, roles, [payload]);
        }, "项目配置已更新。");
        return;
      }
      setSavingBudgets(true);
      const request = ++saveSequence.current;
      try {
        const ok = await manageAdminBudget(kind, item, payload);
        if (ok && request === saveSequence.current) {
          close();
          notify(
            kind === "delete"
              ? "项目已删除，删除前快照保留在服务端操作日志。"
              : "项目已保存，已有分配保留，请重新复核并同步。",
          );
        }
      } finally {
        if (request === saveSequence.current) setSavingBudgets(false);
      }
    } catch (error) {
      setBudgetError(error.message || "配置校验失败。");
      notify(error.message || "配置校验失败。", true);
    }
  }

  async function persistAdminBudgets(items) {
    const request = ++saveSequence.current;
    setModal(null);
    setSavingBudgets(true);
    try {
      return await saveAdminBudgets(items);
    } finally {
      if (request === saveSequence.current) setSavingBudgets(false);
    }
  }

  async function persistAdminImport(payload) {
    const request = ++saveSequence.current;
    setModal(null);
    setSavingBudgets(true);
    try {
      return await importAdminBudgets(payload);
    } finally {
      if (request === saveSequence.current) setSavingBudgets(false);
    }
  }

  async function exportConfig() {
    const previewEpoch = getPreviewEpoch();
    try {
      const bytes = await exportExcelInWorker("admin", state, identity);
      await validatePortalSession();
      assertPreviewResponseCurrent(previewEpoch);
      const url = URL.createObjectURL(
        new Blob([bytes], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "管理员配置_预算与归属_2027.xlsx";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify("已导出当前配置，可修改已有项目或在表尾新增 Initiative 后导入。");
    } catch (error) {
      if (previewEpoch === getPreviewEpoch()) notify(error.message, true);
    }
  }
  async function importConfig(event) {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    const request = ++sequence.current;
    const before = state,
      actor = identity;
    setBusy(true);
    setModal(null);
    try {
      if (file.size > 10 * 1024 * 1024)
        throw Error("配置文件请控制在 10 MB 以内。");
      const buffer = await file.arrayBuffer();
      const result = apiMode
        ? await previewExcelInWorker("admin", buffer, before, actor, roles)
        : await AX.previewImport(buffer, before, actor, roles);
      if (request !== sequence.current) return;
      if (
        latest.current.state !== before ||
        latest.current.identity !== actor ||
        latest.current.tab !== "budgets"
      ) {
        notify("读取期间配置或身份已变化，请重新导入。", true);
        return;
      }
      setModal({ kind: "import", result, filename: file.name });
    } catch (error) {
      if (request === sequence.current) notify(error.message, true);
    } finally {
      if (request === sequence.current) setBusy(false);
    }
  }
  async function importReference(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = await parseReferenceInWorker(await file.text());
      if (!parsed.batchId || !parsed.asOf || !Array.isArray(parsed.dealers))
        throw Error("JSON 须包含 batchId、asOf 和 dealers 数组。");
      await saveReference(parsed);
    } catch (error) {
      notify(error.message || "历史参考 JSON 无法读取。", true);
    }
  }
  function saveEdit() {
    if (apiMode && modal.kind === "budget")
      return persistAdminBudgets([
        {
          id: modal.item.id,
          expected_revision: modal.item.revision,
          budget: Number(value),
          ownerId: modal.item.ownerId,
        },
      ]);
    if (apiMode && modal.kind === "owner")
      return persistAdminBudgets([
        {
          id: modal.item.id,
          expected_revision: modal.item.revision,
          budget: modal.item.budget,
          ownerId: value,
        },
      ]);
    if (apiMode && modal.kind === "reason") {
      const reasons = state.budgetReasons.map((row) =>
        row.id === modal.item?.id ? { ...row, label: value.trim() } : row,
      );
      if (!modal.item)
        reasons.push({
          id: `reason-${crypto.randomUUID()}`,
          label: value.trim(),
          enabled: true,
        });
      return saveConfig({ budgetReasons: reasons }).then((ok) => ok && close());
    }
    if (modal.kind === "budget")
      change((draft) => {
        if (value.trim() === "") throw Error("预算不能为空。");
        E.setBudget(draft, modal.item.id, Number(value), identity);
      }, "预算已变更，原分配保持不变，需由 Marketer 复核并重新同步。");
    if (modal.kind === "owner")
      change(
        (draft) => E.setOwner(draft, modal.item.id, value, identity),
        "Owner 映射已更新，原分配保留。",
      );
    if (modal.kind === "reason")
      change((draft) => {
        const reasons = draft.budgetReasons.map((row) => ({ ...row }));
        if (modal.item)
          reasons.find((row) => row.id === modal.item.id).label = value.trim();
        else
          reasons.push({
            id: `reason-${crypto.randomUUID()}`,
            label: value.trim(),
            enabled: true,
          });
        E.setBudgetReasons(draft, reasons, identity);
      }, "预算原因已更新，已有记录保留。");
  }
  if (identity.role !== "admin")
    return <div className="empty">仅管理员可访问管理后台。</div>;

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>管理后台</h1>
          <p>维护预算、参考数据和分析依据。业务工作稿按操作即时保存。</p>
        </div>
      </div>
      <Tabs value={tab} onValueChange={switchTab}>
        <TabsList aria-label="管理后台栏目" className="flex-wrap h-auto">
          {tabs.map(([id, label]) => (
            <TabsTrigger key={id} value={id}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {tab === "budgets" && (
        <Card className="panel gap-0 py-0" aria-busy={budgetPending}>
          <div className="panel-header admin-config-header">
            <div>
              <h2>预算与 Owner 映射</h2>
              <p className="small-text muted">
                {items.length} 项 · 总预算 {money(E.totals(items).budget)}
              </p>
            </div>
            <div className="actions">
              <Button
                variant="outline"
                size="sm"
                type="button"
                disabled={budgetPending || previewMode}
                onClick={() => setModal({ kind: "create", form: budgetForm() })}
              >
                新增
              </Button>
              <Button
                variant="outline"
                size="sm"
                type="button"

                disabled={budgetPending}
                onClick={exportConfig}
              >
                导出配置
              </Button>
              <Button
                variant="default"
                size="sm"
                type="button"

                disabled={budgetPending || previewMode}
                onClick={() => upload.current.click()}
              >
                {budgetPending ? "数据更新中…" : "导入 Excel"}
              </Button>
              <Input
                ref={upload}
                className="upload-input"
                type="file"
                disabled={previewMode}
                accept=".xlsx"
                aria-label="上传管理员配置 Excel"
                onChange={importConfig}
              />
            </div>
          </div>
          <div className="admin-config-hint">
            导出当前配置后，可修改已有项目的预算或 Owner，也可在表尾补充新
            Initiative；导入时统一预览新增与修改。未列出的已有项目保持不变。
          </div>
          <div className="toolbar">
            <Label className="form-field">
              Initiative
              <Input
                type="search"
                value={initiativeSearch}
                placeholder="模糊搜索 Initiative"
                onChange={(event) => setInitiativeSearch(event.target.value)}
              />
            </Label>
            <span className="small-text muted">
              显示 {matchedItems.length} / {items.length} 项
            </span>
          </div>
          <div
            className={`admin-config-list ${budgetPending ? "is-loading" : ""}`}
          >
            <div className="table-scroll">
              <Table containerClassName="overflow-visible">
                <TableHeader>
                  <TableRow>
                    <TableHead>Initiative</TableHead>
                    <TableHead>Sector</TableHead>
                    <TableHead>资源类型</TableHead>
                    <TableHead>部门 / Owner</TableHead>
                    <TableHead className="num">预算</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {matchedItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        {item.name}
                        <div className="table-sub">{item.id}</div>
                      </TableCell>
                      <TableCell>{item.sector}</TableCell>
                      <TableCell>{item.resourceType}</TableCell>
                      <TableCell>
                        {item.department} / {item.ownerId}
                      </TableCell>
                      <TableCell className="num">
                        {money(item.budget)}
                      </TableCell>
                      <TableCell>
                        <div className="actions">
                          <Button
                            variant="outline"
                            size="sm"
                            type="button"

                            disabled={budgetPending || previewMode}
                            onClick={() =>
                              setModal({
                                kind: "edit",
                                item,
                                form: budgetForm(item),
                              })
                            }
                          >
                            编辑
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            type="button"

                            disabled={budgetPending || previewMode}
                            onClick={() => setModal({ kind: "delete", item })}
                          >
                            删除
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {matchedItems.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6}>没有匹配的 Initiative。</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            {budgetPending && (
              <div
                className="admin-list-loading"
                role="status"
                aria-live="polite"
              >
                <span className="admin-loading-spinner" aria-hidden="true" />
                <strong>正在更新预算与 Owner 配置</strong>
                <span>数据准备完成后即可继续编辑</span>
              </div>
            )}
          </div>
          <div className="table-footer">
            预算与归属可持续调整；不会自动重分配。共享结果在 Marketer
            再次同步后更新。
          </div>
        </Card>
      )}
      {tab === "reasons" && (
        <Card className="panel gap-0 py-0">
          <div className="panel-header">
            <div>
              <h2>其他预算原因</h2>
              <p className="small-text muted">
                用于 Marketer 添加预算安排时的下拉选项；停用后保留已有记录。
              </p>
            </div>
            <Button
              variant="default"
              size="sm"
              type="button"

              disabled={previewMode}
              onClick={() => edit("reason", null, "")}
            >
              + 添加原因
            </Button>
          </div>
          <div className="table-scroll">
            <Table containerClassName="overflow-visible">
              <TableHeader>
                <TableRow>
                  <TableHead>原因名称</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.budgetReasons.map((reason) => (
                  <TableRow key={reason.id}>
                    <TableCell>{reason.label}</TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={`badge ${reason.enabled ? "teal" : ""}`}
                      >
                        {reason.enabled ? "启用" : "停用"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"

                        disabled={previewMode}
                        onClick={() => edit("reason", reason, reason.label)}
                      >
                        改名
                      </Button>{" "}
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"

                        disabled={previewMode}
                        onClick={() =>
                          apiMode
                            ? saveConfig({
                                budgetReasons: state.budgetReasons.map((row) =>
                                  row.id === reason.id
                                    ? { ...row, enabled: !row.enabled }
                                    : row,
                                ),
                              })
                            : mutate(
                                (draft) =>
                                  E.setBudgetReasons(
                                    draft,
                                    draft.budgetReasons.map((row) =>
                                      row.id === reason.id
                                        ? { ...row, enabled: !row.enabled }
                                        : row,
                                    ),
                                    identity,
                                  ),
                                "预算原因状态已更新，已有记录保留。",
                              )
                        }
                      >
                        {reason.enabled ? "停用" : "启用"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
      {tab === "reference" && (
        <>
          <Card className="panel gap-0 py-0">
            <div className="panel-header">
              <h2>历史参考数据批次</h2>
              <Badge variant="secondary" className="badge">
                {apiMode ? "服务端批次" : "本地模拟"}
              </Badge>
            </div>
            <div className="panel-body">
              <dl className="definition-grid">
                <dt>数据截至期</dt>
                <dd>
                  {state.reference.asOf}{" "}
                  {!apiMode && (
                    <span className="muted">
                      （2026 为 1—8 月累计演示假设）
                    </span>
                  )}
                </dd>
                <dt>导入时间</dt>
                <dd>{time(state.reference.importedAt)}</dd>
                <dt>当前批次号</dt>
                <dd>{state.reference.batchId}</dd>
                <dt>记录数</dt>
                <dd>60 个经销商 · 75 个 Initiative · 600 条初始分配</dd>
                <dt>发布校验</dt>
                <dd>唯一键、主数据匹配、资源加总和计划金额已通过源数据核对</dd>
              </dl>
              <div className="flow-diagram">
                <span>历史表数据刷新</span>
                <b>→</b>
                <span>暂存与校验</span>
                <b>→</b>
                <span>发布到 PostgreSQL</span>
              </div>
              <Alert role="note" className="note-box">
                <AlertDescription>
                  {apiMode
                    ? "上传 JSON 后由服务端核验并整批写入；缺失历史值请使用 null，不补零。"
                    : "当前仅模拟发布状态与版本变化，沿用同一份历史数值，不补造下个月业绩。"}
                </AlertDescription>
              </Alert>
              <div className="actions">
                {apiMode ? (
                  <>
                    <Button
                      variant="default"
                      type="button"

                      disabled={previewMode}
                      onClick={() => referenceUpload.current?.click()}
                    >
                      导入历史 JSON
                    </Button>
                    <Input
                      ref={referenceUpload}
                      disabled={previewMode}
                      type="file"
                      accept="application/json,.json"
                      hidden
                      onChange={importReference}
                    />
                  </>
                ) : (
                  <>
                    <Button
                      variant="default"
                      type="button"

                      onClick={() => setModal({ kind: "reference" })}
                    >
                      校验并模拟发布新批次
                    </Button>
                    <Button
                      variant="outline"
                      type="button"

                      onClick={() => setModal({ kind: "reference-fail" })}
                    >
                      模拟校验失败
                    </Button>
                  </>
                )}
              </div>
            </div>
          </Card>
          <Card className="panel gap-0 py-0">
            <div className="panel-header">
              <h2>预期表现数据</h2>
              <Badge variant="secondary" className="badge">
                未提供
              </Badge>
            </div>
            <div className="panel-body">
              <p className="small-text muted">
                源文件没有 2027 预计 Vol、C3，也没有实际执行数据。当前仅有 2027
                预算及分配，不生成预测或 Tracking。
              </p>
            </div>
          </Card>
        </>
      )}
      {tab === "permissions" && (
        <Card className="panel gap-0 py-0">
          <div className="panel-header">
            <h2>{apiMode ? "人员与权限映射" : "演示人员与权限映射"}</h2>
            <Badge variant="secondary" className="badge">
              {apiMode ? "服务端配置" : "模拟配置"}
            </Badge>
          </div>
          <div className="panel-body">
            <Alert role="note" className="note-box">
              <AlertDescription>
                {apiMode
                  ? "管理员可维护人员账号与权限。已关联 Initiative 的用户不可修改或删除；权限由服务端执行。"
                  : "部门并非 Excel 原始字段。本原型用资源类型映射部门，并为每个部门配置两位 Owner。此处展示演示权限。"}
              </AlertDescription>
            </Alert>
            {apiMode ? (
              <AdminUsersPanel />
            ) : (
              <>
                <div className="table-scroll">
                  <Table
                    containerClassName="overflow-visible"
                    className="contract-table"
                  >
                    <TableHeader>
                      <TableRow>
                        <TableHead>角色</TableHead>
                        <TableHead>分配操作</TableHead>
                        <TableHead>历史资源范围</TableHead>
                        <TableHead>协作权限</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {E.DEPARTMENTS.map((department) => (
                        <TableRow key={department}>
                          <TableCell>{department} Marketer 1 / 2</TableCell>
                          <TableCell>
                            仅本人 Initiative
                            <br />
                            可看部门汇总，不可打开同事明细
                          </TableCell>
                          <TableCell>
                            {department === "MKT"
                              ? "MRD、SP&A"
                              : department === "ICE"
                                ? "ICE Rebate"
                                : "Capex"}
                            <br />
                            Vol / C3 按演示共享授权
                          </TableCell>
                          <TableCell>
                            保存、导入、反复同步、本人 Insight
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow>
                        <TableCell>部门负责人</TableCell>
                        <TableCell>本部门明细只读</TableCell>
                        <TableCell>本部门授权资源</TableCell>
                        <TableCell>本部门只读汇总、部门 Insight</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>管理层</TableCell>
                        <TableCell>各部门同步快照只读</TableCell>
                        <TableCell>全局同步结果及授权整体参考</TableCell>
                        <TableCell>
                          最新同步结果只读、筛选排序、线下沟通
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>管理员</TableCell>
                        <TableCell>维护预算、Owner；不代改分配</TableCell>
                        <TableCell>维护参考数据与权限配置</TableCell>
                        <TableCell>变更记录、分析指南维护</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </div>
        </Card>
      )}
      {tab === "permissions" && apiMode && (
        <HistoricalResourceSettings
          key={state.configRevision}
          mapping={state.departmentResources || {}}
          departments={[
            ...new Set([
              ...state.initiatives.map((item) => item.department),
              ...roles.flatMap((user) => E.departments(user)),
            ]),
          ]}
          saveConfig={saveConfig}
          readOnly={previewMode}
        />
      )}
      {tab === "guide" && (
        <Card className="panel gap-0 py-0">
          <div className="panel-header">
            <h2>业务分析指南</h2>
            <Badge variant="secondary" className="badge blue">
              v{state.guide.version}
            </Badge>
          </div>
          <div className="panel-body">
            <Label className="form-field">
              指南内容
              <Textarea
                rows={7}
                readOnly={previewMode}
                value={guide}
                onChange={(event) => setGuide(event.target.value)}
              />
              <small>
                固定输出：发现 / 证据 / 对象 /
                复核方向。指南变更使旧分析标为待更新。
              </small>
            </Label>
            <Button
              variant="default"
              type="button"

              disabled={previewMode}
              onClick={() =>
                apiMode
                  ? saveConfig({ guide: { ...state.guide, text: guide } })
                  : mutate(
                      (draft) => E.setGuide(draft, guide, identity),
                      "指南新版本已保存，已有 Insight 需复核更新。",
                    )
              }
            >
              保存为新指南版本
            </Button>
            <Alert role="note" className="note-box">
              <AlertDescription>
                {apiMode
                  ? "指南由服务端保存并用于后续六点分析；保存后旧分析需更新。"
                  : "本原型只演示指南保存、版本与失效关系。模拟分析为确定性模板。"}
              </AlertDescription>
            </Alert>
          </div>
        </Card>
      )}
      {tab === "audit" && (
        <Card className="panel gap-0 py-0">
          <div className="panel-header">
            <h2>操作与版本记录</h2>
            <span className="small-text muted">
              {apiMode ? "服务端操作记录" : "当前浏览器演示记录"}
            </span>
          </div>
          <div className="table-scroll">
            <Table
              containerClassName="overflow-visible"
              className="audit-table"
            >
              <TableHeader>
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>动作</TableHead>
                  <TableHead>对象</TableHead>
                  <TableHead>说明</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.audit
                  .slice()
                  .reverse()
                  .map((entry, index) => (
                    <TableRow key={entry.id || index}>
                      <TableCell>{time(entry.createdAt)}</TableCell>
                      <TableCell>
                        {entry.actor.label ||
                          entry.actor.ownerId ||
                          E.departments(entry.actor).join("、") ||
                          entry.actor.role}
                      </TableCell>
                      <TableCell>
                        {actionNames[entry.action] || entry.action}
                      </TableCell>
                      <TableCell>{entry.object}</TableCell>
                      <TableCell>{entry.detail || "—"}</TableCell>
                    </TableRow>
                  ))}
                {!state.audit.length && (
                  <TableRow>
                    <TableCell colSpan={5}>尚无操作记录。</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
      {modal && ["create", "edit", "delete"].includes(modal.kind) && (
        <AdminDialog
          title={
            {
              create: "新增 Initiative",
              edit: "编辑 Initiative",
              delete: "删除 Initiative",
            }[modal.kind]
          }
          onClose={() => {
            if (!savingBudgets) close();
          }}
          onConfirm={saveBudgetOperation}
          error={budgetError}
          disabled={budgetPending}
          confirmLabel={
            savingBudgets
              ? "正在保存…"
              : modal.kind === "delete"
                ? "确认删除"
                : "保存"
          }
        >
          {modal.kind === "delete" ? (
            <Alert variant="destructive" role="note" className="note-box warn">
              <AlertDescription>
                确认删除“{modal.item.name}”（ID：{modal.item.id}
                ）？此操作将删除该项目及其经销商分配、其他预算和同步记录，无法在页面撤销。删除前快照保留在服务端操作日志。
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <AdminBudgetFields
                value={modal.form}
                onChange={(form) =>
                  setModal((current) => ({ ...current, form }))
                }
                users={roles}
                apiMode={apiMode}
                disabled={budgetPending}
              />
              {modal.kind === "edit" && (
                <Alert role="note" className="note-box">
                  <AlertDescription>
                    修改字段后保留已有分配，历史同步版本保持原样，需由 Owner
                    重新复核并同步。
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}
        </AdminDialog>
      )}
      {modal && ["budget", "owner", "reason"].includes(modal.kind) && (
        <AdminDialog
          title={
            {
              budget: "管理员调整预算",
              owner: "维护 Initiative Owner",
              reason: modal.item ? "修改预算原因" : "添加预算原因",
            }[modal.kind]
          }
          onClose={close}
          onConfirm={saveEdit}
        >
          {modal.item && modal.kind !== "reason" && (
            <p>
              {modal.item.name} · {modal.item.sector} · {modal.item.department}
            </p>
          )}
          {modal.kind === "budget" && (
            <>
              <Label className="form-field">
                新的 Initiative 总预算
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                />
              </Label>
              <Alert
                variant="destructive"
                role="note"
                className="note-box warn"
              >
                <AlertDescription>
                  仅变更预算上限，不自动改分配。需要 Marketer
                  重新平衡并同步，旧分析将待更新。
                </AlertDescription>
              </Alert>
            </>
          )}
          {modal.kind === "owner" && (
            <>
              <Label className="form-field">
                部门内 Owner
                <NativeSelect
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                >
                  {(apiMode
                    ? roles.filter(
                        (user) =>
                          ["owner", "lead"].includes(user.role) &&
                          E.hasDepartment(user, modal.item.department),
                      )
                    : [1, 2].map((n) => ({
                        key: `${modal.item.department}-${n}`,
                        ownerId: `${modal.item.department}-${n}`,
                        label: `${modal.item.department}-${n}`,
                      }))
                  ).map((owner) => (
                    <NativeSelectOption
                      key={owner.key || owner.ownerId || owner.email}
                      value={owner.ownerId || owner.email}
                    >
                      {owner.label || owner.display_name || owner.email}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Label>
              <Alert role="note" className="note-box">
                <AlertDescription>
                  不改变部门与资源类型归属；变更后由新的 Owner 复核并同步。
                </AlertDescription>
              </Alert>
            </>
          )}
          {modal.kind === "reason" && (
            <Label className="form-field">
              原因名称
              <Input
                maxLength={80}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder="如：新增经销商预留"
              />
            </Label>
          )}
        </AdminDialog>
      )}
      {modal?.kind === "reference" && (
        <AdminDialog
          title="参考批次发布预览"
          onClose={close}
          confirmLabel="确认模拟发布"
          onConfirm={() =>
            change(
              (draft) => E.changeReference(draft, identity),
              "新模拟批次已发布；已同步版本仍保留原依据。",
            )
          }
        >
          <Alert role="note" className="note-box success">
            <AlertDescription>
              源数据唯一键、经销商匹配、资源加总核对通过。
            </AlertDescription>
          </Alert>
          <p>
            本次演示复用当前 60
            个经销商的历史值，只更新批次号和导入时间；数据截至期保持{" "}
            {state.reference.asOf}。
          </p>
          <Alert role="note" className="note-box">
            <AlertDescription>
              发布不修改预算、分配或已同步快照。后续草稿分析使用新批次，旧分析标为待更新。
            </AlertDescription>
          </Alert>
        </AdminDialog>
      )}
      {modal?.kind === "reference-fail" && (
        <AdminDialog title="模拟批次校验失败" onClose={close}>
          <Alert variant="destructive" role="note" className="note-box error">
            <AlertDescription>
              模拟错误：暂存批次出现重复经销商主键。未发布任何数据。
            </AlertDescription>
          </Alert>
          <p>
            继续使用当前批次 <b>{state.reference.batchId}</b>，截至{" "}
            {state.reference.asOf}。这只是失败状态演示，源数据并无此错误。
          </p>
        </AdminDialog>
      )}
      {modal?.kind === "import" && (
        <AdminDialog
          title="管理员配置导入预览"
          onClose={close}
          disabled={
            !!modal.result.errors.length ||
            (!modal.result.changes.length && !modal.result.creates.length)
          }
          confirmLabel={
            modal.result.errors.length
              ? "请修正文件后重试"
              : `确认导入 ${modal.result.changes.length + modal.result.creates.length} 项`
          }
          onConfirm={() =>
            apiMode
              ? persistAdminImport({
                  updates: modal.result.changes.map((row) => ({
                    id: row.id,
                    expected_revision: row.revision,
                    budget: row.after.budget,
                    ownerId: row.after.ownerId,
                  })),
                  creates: modal.result.creates.map(({ row, ...item }) => item),
                })
              : change(
                  (draft) => AX.confirmImport(modal.result, draft, identity),
                  `已新增 ${modal.result.creates.length} 项、更新 ${modal.result.changes.length} 项；已有项目原分配保留，需由 Owner 复核并重新同步。`,
                )
          }
        >
          <p className="small-text muted">
            {modal.filename} · {modal.result.rows} 行 ·{" "}
            {modal.result.creates.length} 项新增 · {modal.result.changes.length}{" "}
            项修改 · {modal.result.unchanged} 项不变
          </p>
          {modal.result.errors.length ? (
            <Alert variant="destructive" role="note" className="note-box error">
              <AlertDescription>
                <strong>校验未通过，整份文件不会写入</strong>
                <ul className="import-errors">
                  {modal.result.errors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="destructive" role="note" className="note-box warn">
              <AlertDescription>
                {modal.result.changes.length || modal.result.creates.length
                  ? "确认后将新增和修改整批写入；任一行失败则全部不写入。已有项目的原经销商分配保留，受影响项目需复核并重新同步。"
                  : "导入配置与当前一致，无需写入。"}
              </AlertDescription>
            </Alert>
          )}
          <div className="admin-import-summary">
            <span>
              当前总预算 <b>{money(modal.result.summary.before)}</b>
            </span>
            <span>
              导入后总预算{" "}
              <b>
                {modal.result.errors.length
                  ? "—"
                  : money(modal.result.summary.after)}
              </b>
            </span>
          </div>
          <div className="table-scroll">
            <Table containerClassName="overflow-visible">
              <TableHeader>
                <TableRow>
                  <TableHead>类型</TableHead>
                  <TableHead>Initiative / 部门</TableHead>
                  <TableHead>预算变化</TableHead>
                  <TableHead>Owner 变化</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {modal.result.changes.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>修改</TableCell>
                    <TableCell>
                      <b>{row.name}</b>
                      <div className="table-sub">
                        {row.id} · {row.department}
                      </div>
                    </TableCell>
                    <TableCell>
                      {money(row.before.budget)} →{" "}
                      <b>{money(row.after.budget)}</b>
                    </TableCell>
                    <TableCell>
                      {row.before.ownerId} →{" "}
                      <b>{row.after.ownerId || "未填写"}</b>
                    </TableCell>
                  </TableRow>
                ))}
                {modal.result.creates.map((row) => (
                  <TableRow key={`create-${row.row}`}>
                    <TableCell>
                      <b>新增</b>
                    </TableCell>
                    <TableCell>
                      <b>{row.name}</b>
                      <div className="table-sub">
                        新项目 · {row.department} · {row.resourceType}
                      </div>
                    </TableCell>
                    <TableCell>
                      — → <b>{money(row.budget)}</b>
                    </TableCell>
                    <TableCell>
                      — → <b>{row.ownerId}</b>
                    </TableCell>
                  </TableRow>
                ))}
                {!modal.result.changes.length &&
                  !modal.result.creates.length && (
                    <TableRow>
                      <TableCell colSpan={4}>
                        <div className="empty">没有配置差异</div>
                      </TableCell>
                    </TableRow>
                  )}
              </TableBody>
            </Table>
          </div>
          <p className="small-text muted">
            新增行请将 Initiative
            编号、修订号和状态留空；未列出的已有项目保持不变。确认时再次检查管理员身份、项目修订及人员配置。
          </p>
        </AdminDialog>
      )}
    </>
  );
}
import { validatePortalSession } from "../../portal/session";
import { assertPreviewResponseCurrent, getPreviewEpoch } from "../userPreview";
