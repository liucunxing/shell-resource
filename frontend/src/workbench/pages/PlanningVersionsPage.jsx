import { Alert, AlertDescription } from "../../components/ui/alert";
import { Card } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "../../components/ui/table";
import { Badge } from "../../components/ui/badge";
import { Checkbox } from "../../components/ui/checkbox";
import { Label } from "../../components/ui/label";
import { Input } from "../../components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "../../components/ui/native-select";
import { useRef, useState } from "react";
import * as api from "../api.js";
import { useWorkbench } from "../WorkbenchContext.jsx";
import { versionStatus } from "./PlanningVersionBar.jsx";
import { WorkflowDialog } from "./WorkflowDialog.jsx";
import { wholeMetric } from "../domain/metric-precision";

export function versionSummary(version, state) {
  if (
    version.id !== (state.currentVersionId || state.planningVersion?.id) ||
    !Array.isArray(state.initiatives)
  )
    return null;
  const enabled = state.initiatives.filter((item) => item.enabled !== false);
  if (
    enabled.some(
      (item) =>
        item.budget == null ||
        item.budget === "" ||
        !Number.isFinite(Number(item.budget)),
    )
  )
    return { count: enabled.length, budget: null };
  return {
    count: enabled.length,
    budget: enabled.reduce((sum, item) => sum + Number(item.budget), 0),
  };
}

export function displayVersionOrder(versions) {
  return [...versions].sort((a, b) =>
    String(a.id).localeCompare(String(b.id), "en", { numeric: true }),
  );
}

export function PlanningVersionsPage() {
  const {
    state,
    refresh,
    refreshPlanningVersions,
    notify,
    previewMode,
    apiMode,
  } = useWorkbench();
  const versions = state.planningVersions || [];
  const displayedVersions = displayVersionOrder(versions);
  const [dialog, setDialog] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [deleteAcknowledged, setDeleteAcknowledged] = useState(false);
  const pending = useRef(false);
  const [form, setForm] = useState({ id: "", name: "", source: "empty" });
  const publishedSources = versions.filter(version => version.published);
  const invalidCopySource = form.source && !["empty", "legacy"].includes(form.source) && (
    !publishedSources.some(version => version.id === form.source) ||
    (form.id.length === 6 && form.source >= form.id)
  );
  const open = (value) => {
    setError("");
    setActionError("");
    setDialog(value);
  };
  const persist = async () => {
    if (previewMode || !apiMode || busy || pending.current || !dialog) return;
    if (dialog.kind === "create" && invalidCopySource) return;
    if (dialog.kind === "delete-confirm" && dialog.info.submittedCount > 0 && !deleteAcknowledged) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const changesCurrent = ["create", "activate"].includes(dialog.kind) ||
        dialog.version?.id === (state.currentVersionId || state.planningVersion?.id);
      if (dialog.kind === "create") {
        await api.createPlanningVersion({
          id: form.id.trim(),
          name: form.name.trim(),
          ...(form.source === "empty" ? { creation_mode: "empty" } :
            form.source === "legacy" ? {} : { creation_mode: "copy", source_version_id: form.source }),
        });
        api.setPlanningVersion(form.id.trim());
      } else if (dialog.kind === "edit-confirm") {
        await api.updatePlanningVersion(dialog.version.id, {
          expected_revision: dialog.version.revision,
          id: form.id.trim(), name: form.name.trim(),
        });
        if ((state.currentVersionId || state.planningVersion?.id) === dialog.version.id)
          api.setPlanningVersion(form.id.trim());
      } else if (dialog.kind === "clear-drafts") {
        await api.clearPlanningVersionDrafts(dialog.version.id, {
          expected_revision: dialog.version.revision, confirmed: true,
        });
      } else if (dialog.kind === "delete-confirm") {
        await api.deletePlanningVersion(dialog.version.id, {
          expected_revision: dialog.info.revision,
          confirm_submitted: dialog.info.submittedCount > 0 && deleteAcknowledged,
        });
        if ((state.currentVersionId || state.planningVersion?.id) === dialog.version.id)
          api.setPlanningVersion("");
      } else {
        await api.updatePlanningVersion(dialog.version.id, {
          expected_revision: dialog.version.revision,
          ...(dialog.kind === "activate"
            ? { published: true, open: true }
            : { open: false }),
        });
      }
      setDialog(null);
      const result = dialog.kind === "clear-drafts" ? `版本 ${dialog.version.id} 的全部草稿已清空` : "规划版本已保存";
      const reload = changesCurrent ? refresh({ preservePage: true }) : refreshPlanningVersions();
      if (!await reload.catch(() => false)) {
        notify(`${result}，但刷新失败，请重新加载后继续。`, true);
        return;
      }
      notify(`${result}。`);
    } catch (failure) {
      setError(failure.message);
      setActionError(failure.message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const startDelete = async (version) => {
    if (previewMode || !apiMode || busy || pending.current) return;
    pending.current = true;
    setBusy(true);
    setActionError("");
    try {
      const info = await api.planningVersionDeletionInfo(version.id);
      if (!info.canDelete) throw Error("请先停用版本，再移除规划版本。");
      setDeleteAcknowledged(false);
      open({ kind: info.submittedCount ? "delete-warning" : "delete-confirm", version, info });
    } catch (failure) {
      setActionError(failure.message || "无法检查版本，请刷新后重试。");
    } finally { pending.current = false; setBusy(false); }
  };
  return (
    <>
      <Card className="panel studio-admin-panel gap-4 p-4">
        <div className="panel-header">
          <div>
            <h2>规划版本</h2>
            <p>
              全新版本从空白项目列表开始；复制已有版本时，来源版本最后提交的方案将成为新草稿。
            </p>
          </div>
          <Button
            variant="default"
            type="button"
            disabled={previewMode || !apiMode || busy}
            onClick={() => {
              setForm({ id: "", name: "", source: "empty" });
              open({ kind: "create" });
            }}
          >
            ＋ 创建规划版本
          </Button>
        </div>
        <div className="table-scroll">
          <Table containerClassName="overflow-visible">
            <TableHeader>
              <TableRow>
                <TableHead>版本 / 来源</TableHead>
                <TableHead>名称</TableHead>
                <TableHead>创建人</TableHead>
                <TableHead className="num">启用 Initiative</TableHead>
                <TableHead className="num">预算合计（元）</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayedVersions.map((version) => (
                <TableRow key={version.id}>
                  <TableCell>
                    <strong>{version.id}</strong>
                    <small>来源版本 {version.sourceVersionId || "—"}</small>
                  </TableCell>
                  <TableCell>{version.name}</TableCell>
                  <TableCell>{version.createdBy || "—"}</TableCell>
                  <TableCell className="num">
                    {wholeMetric(versionSummary(version, state)?.count)}
                  </TableCell>
                  <TableCell className="num" sortValue={versionSummary(version, state)?.budget}>
                    {versionSummary(version, state)?.budget == null
                      ? "—"
                      : wholeMetric(versionSummary(version, state).budget)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={`resource-status ${version.published && version.open ? "done" : "editing"}`}
                    >
                      {versionStatus(version)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="version-row-actions flex flex-nowrap items-center gap-2">
                      <Button variant="outline" size="sm" type="button"
                        disabled={previewMode || !apiMode || busy}
                        onClick={() => {
                          setForm({ id: version.id, name: version.name });
                          open({ kind: "edit", version });
                        }}>编辑</Button>
                      <Button variant="destructive" size="sm" type="button"
                        disabled={previewMode || !apiMode || busy || (version.published && version.open)}
                        title={version.published && version.open ? "请先停用版本" : "移除版本"}
                        onClick={() => startDelete(version)}>移除</Button>
                      <Button variant="outline" size="sm" type="button"
                        disabled={previewMode || !apiMode || busy || (version.published && version.open)}
                        onClick={() => open({ kind: "activate", version })}>启用</Button>
                      <Button variant="outline" size="sm" type="button"
                        disabled={previewMode || !apiMode || busy || !(version.published && version.open)}
                        onClick={() => open({ kind: "deactivate", version })}>停用</Button>
                      <Button variant="outline" size="sm" type="button"
                        disabled={previewMode || !apiMode || busy}
                        onClick={() => open({ kind: "clear-drafts", version })}>清空草稿</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!versions.length && (
                <TableRow>
                  <TableCell colSpan="7">
                    <div className="empty">
                      尚未创建规划版本。
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <p className="tiny">
          启用项目数与预算合计只统计已加载版本；其他版本未加载时显示“—”，可在项目配置页面切换版本查看。
        </p>
      </Card>
      <p className="tiny">同时仅一个版本开放提交。启用一个版本时，其他版本自动停用；停用后分配不能再修改或提交，已有数据仍可按原权限查看，管理员仍可维护项目配置。移除后版本不再显示在业务列表，历史数据保留供审计。</p>
      {actionError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}
      {dialog && (
        <WorkflowDialog
          title={
            dialog.kind === "create" ? "创建规划版本" :
            dialog.kind === "edit" ? `编辑规划版本 · ${dialog.version.id}` :
            dialog.kind === "edit-confirm" ? "确认修改规划版本" :
            dialog.kind === "delete-warning" ? "移除前请确认" :
            dialog.kind === "delete-confirm" ? "确认移除规划版本" :
            dialog.kind === "clear-drafts" ? `清空全部草稿 · ${dialog.version.id} · ${dialog.version.name}` :
            `${dialog.kind === "deactivate" ? "停用版本" : "启用版本"} · ${dialog.version.name}`
          }
          busy={busy}
          onClose={() => setDialog(null)}
          onConfirm={dialog.kind === "edit" ? () => open({ ...dialog, kind: "edit-confirm" }) :
            dialog.kind === "delete-warning" ? () => open({ ...dialog, kind: "delete-confirm" }) : persist}
          confirmLabel={dialog.kind === "edit" || dialog.kind === "delete-warning" ? "继续" : dialog.kind === "delete-confirm" ? "确认移除" : dialog.kind === "clear-drafts" ? "确认清空全部草稿" : "确认"}
          confirmVariant={["delete-confirm", "clear-drafts"].includes(dialog.kind) ? "destructive" : "default"}
          disabled={
            previewMode || !apiMode ||
            (["create", "edit"].includes(dialog.kind) &&
              (!/^20\d{2}(0[1-9]|1[0-2])$/.test(form.id) || !form.name.trim())) ||
            (dialog.kind === "create" && invalidCopySource) ||
            (dialog.kind === "delete-warning" && !deleteAcknowledged)
          }
        >
          {dialog.kind === "create" ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 [&_label]:flex [&_label]:flex-col [&_label]:items-stretch [&_label]:gap-2 [&_label]:text-left">
              <Label>
                版本编码（YYYYMM）
                <Input
                  value={form.id}
                  maxLength="6"
                  onChange={(event) =>
                    setForm({
                      ...form,
                      id: event.target.value.replace(/\D/g, ""),
                    })
                  }
                  placeholder="例如 202701"
                />
              </Label>
              <Label>
                版本名称
                <Input
                  value={form.name}
                  maxLength="100"
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                />
              </Label>
              <Label className="sm:col-span-2">
                创建方式
                <NativeSelect
                  value={form.source}
                  onChange={(event) => setForm({ ...form, source: event.target.value })}
                >
                  <NativeSelectOption value="empty">创建全新版本</NativeSelectOption>
                  {!versions.length && <NativeSelectOption value="legacy">从历史年度预算创建</NativeSelectOption>}
                  {publishedSources.map((version) => (
                    <NativeSelectOption key={version.id} value={version.id}
                      disabled={form.id.length === 6 && version.id >= form.id}>
                      复制版本 {version.id} · {version.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Label>
              <p className="tiny sm:col-span-2">
                {invalidCopySource ? "请选择编码早于新版本的已发布来源版本。" :
                  form.source === "empty" ? "创建后，可在「项目配置」中添加或导入 Initiative。" :
                  "将复制项目配置，并以最后提交的分配方案作为草稿。"}
              </p>
            </div>
          ) : dialog.kind === "edit" ? (
            <div className="grid gap-4">
              <Label>版本编码（YYYYMM）<Input value={form.id} maxLength="6" onChange={(event) => setForm({ ...form, id: event.target.value.replace(/\D/g, "") })} /></Label>
              <Label>版本名称<Input value={form.name} maxLength="100" onChange={(event) => setForm({ ...form, name: event.target.value })} /></Label>
            </div>
          ) : dialog.kind === "clear-drafts" ? (
            <div className="grid gap-2">
              <p>将清空此版本所有 Initiative（含停用项目）的经销商名单、分配金额、预留及其他预算安排和试算草稿。每个项目的全部预算将回到待分配。</p>
              <p>项目配置、预算和 Owner 保留。当前提交和部门确认将重置，Owner 需要重新拆分并提交。此操作无法撤销。</p>
            </div>
          ) : dialog.kind === "delete-warning" ? (
            <div className="grid gap-4">
              <p>该版本有 {wholeMetric(dialog.info.submittedCount)} 条提交记录。移除后业务用户将无法访问该版本，项目和提交记录保留供审计。</p>
              <Label className="flex items-center gap-2"><Checkbox checked={deleteAcknowledged} onCheckedChange={(checked) => setDeleteAcknowledged(checked === true)} />我已了解并确认移除该版本</Label>
            </div>
          ) : dialog.kind === "delete-confirm" ? (
            <p>确认移除版本 {dialog.version.id} · {dialog.version.name}？移除后版本将不再显示在业务列表，历史数据保留供审计。</p>
          ) : dialog.kind === "edit-confirm" ? (
            <>
              <p>确认将版本 {dialog.version.id} 修改为 {form.id} · {form.name}？</p>
              <p>修改版本保留原启用和部门确认状态，不改变已有分配。</p>
            </>
          ) : (
            <p>
              {dialog.kind === "deactivate"
                ? "停用后所有人不能再修改分配或提交，各部门不能再提交或撤回。已有分配方案、提交记录和部门确认保留，仍可按原权限查看；管理员仍可维护项目配置。"
                : "启用后，本版本成为唯一开放提交的版本，其他版本自动停用。已有方案和提交状态保持不变；已提交管理层的部门仍锁定。"}
            </p>
          )}
          {error && (
            <Alert variant="destructive" className="note-box warn" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </WorkflowDialog>
      )}
    </>
  );
}
