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
import { useState } from "react";
import * as api from "../api.js";
import { useWorkbench } from "../WorkbenchContext.jsx";
import { versionStatus } from "./PlanningVersionBar.jsx";
import { WorkflowDialog } from "./WorkflowDialog.jsx";

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
  const [form, setForm] = useState({
    id: "",
    name: "",
    source_version_id: state.currentVersionId || "",
  });
  const open = (value) => {
    setError("");
    setActionError("");
    setDialog(value);
  };
  const persist = async () => {
    setBusy(true);
    setError("");
    try {
      const changesCurrent = ["create", "publish", "open"].includes(dialog.kind) ||
        dialog.version?.id === (state.currentVersionId || state.planningVersion?.id);
      if (dialog.kind === "create") {
        await api.createPlanningVersion({
          id: form.id.trim(),
          name: form.name.trim(),
          ...(form.source_version_id
            ? { source_version_id: form.source_version_id }
            : {}),
        });
        api.setPlanningVersion(form.id.trim());
      } else if (dialog.kind === "edit-confirm") {
        await api.updatePlanningVersion(dialog.version.id, {
          expected_revision: dialog.version.revision,
          id: form.id.trim(), name: form.name.trim(),
        });
        if ((state.currentVersionId || state.planningVersion?.id) === dialog.version.id)
          api.setPlanningVersion(form.id.trim());
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
          ...(dialog.kind === "publish"
            ? { published: true, open: true }
            : { open: dialog.kind === "open" }),
        });
      }
      setDialog(null);
      const refreshed = changesCurrent
        ? await refresh({ preservePage: true })
        : await refreshPlanningVersions();
      if (!refreshed) {
        notify("规划版本已保存，但刷新失败，请重新加载后继续。", true);
        return;
      }
      notify("规划版本已保存。");
    } catch (failure) {
      setError(failure.message);
      setActionError(failure.message);
    } finally {
      setBusy(false);
    }
  };
  const startDelete = async (version) => {
    setBusy(true);
    setActionError("");
    try {
      const info = await api.planningVersionDeletionInfo(version.id);
      if (!info.canDelete) throw Error("请先关闭版本，再删除规划版本。");
      setDeleteAcknowledged(false);
      open({ kind: info.submittedCount ? "delete-warning" : "delete-confirm", version, info });
    } catch (failure) {
      setActionError(failure.message || "无法检查版本，请刷新后重试。");
    } finally { setBusy(false); }
  };
  return (
    <>
      <Card className="panel studio-admin-panel gap-4 p-4">
        <div className="panel-header">
          <div>
            <h2>规划版本</h2>
            <p>
              复制来源版本最后已提交的方案为草稿；不继承提交、确认及退回状态，预算变化不自动缩放金额。
            </p>
          </div>
          <Button
            variant="default"
            type="button"
            disabled={previewMode || !apiMode || busy}
            onClick={() => open({ kind: "create" })}
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
                <TableHead className="num">预算合计（万）</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayedVersions.map((version) => (
                <TableRow key={version.id}>
                  <TableCell>
                    <strong>{version.id}</strong>
                    <small>来源 {version.sourceVersionId || "历史预算"}</small>
                  </TableCell>
                  <TableCell>{version.name}</TableCell>
                  <TableCell>{version.createdBy || "—"}</TableCell>
                  <TableCell className="num">
                    {versionSummary(version, state)?.count ?? "—"}
                  </TableCell>
                  <TableCell className="num" sortValue={versionSummary(version, state)?.budget}>
                    {versionSummary(version, state)?.budget == null
                      ? "—"
                      : (
                          versionSummary(version, state).budget / 10000
                        ).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={`resource-status ${versionStatus(version) === "开放提交" ? "done" : "editing"}`}
                    >
                      {versionStatus(version)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-nowrap items-center gap-2">
                      <Button variant="outline" size="sm" type="button"
                        disabled={previewMode || !apiMode || busy}
                        onClick={() => {
                          setForm({ id: version.id, name: version.name });
                          open({ kind: "edit", version });
                        }}>编辑</Button>
                      <Button variant="destructive" size="sm" type="button"
                        disabled={previewMode || !apiMode || busy || (version.published && version.open)}
                        title={version.published && version.open ? "请先关闭版本" : "删除版本"}
                        onClick={() => startDelete(version)}>删除</Button>
                      <Button variant="outline" size="sm" type="button"
                        disabled={previewMode || !apiMode || busy}
                        onClick={() => open({ kind: version.published && version.open ? "close" : version.published ? "open" : "publish", version })}>
                        {version.published && version.open ? "关闭" : "开始"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!versions.length && (
                <TableRow>
                  <TableCell colSpan="7">
                    <div className="empty">
                      尚未创建规划版本。首次创建将从历史年度预算与最后提交快照建立独立版本。
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
      <p className="tiny">同时仅一个版本开放提交。开始一个版本时，其他版本自动关闭；关闭后已有方案和提交记录保留。</p>
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
            dialog.kind === "delete-warning" ? "删除前请确认" :
            dialog.kind === "delete-confirm" ? "确认删除规划版本" :
            `${dialog.kind === "close" ? "关闭版本" : "开始版本"} · ${dialog.version.name}`
          }
          busy={busy}
          onClose={() => setDialog(null)}
          onConfirm={dialog.kind === "edit" ? () => open({ ...dialog, kind: "edit-confirm" }) :
            dialog.kind === "delete-warning" ? () => open({ ...dialog, kind: "delete-confirm" }) : persist}
          confirmLabel={dialog.kind === "edit" || dialog.kind === "delete-warning" ? "继续" : dialog.kind === "delete-confirm" ? "确认删除" : "确认"}
          disabled={
            (["create", "edit"].includes(dialog.kind) &&
              (!/^20\d{2}(0[1-9]|1[0-2])$/.test(form.id) || !form.name.trim())) ||
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
                复制来源
                <NativeSelect
                  value={form.source_version_id}
                  onChange={(event) =>
                    setForm({ ...form, source_version_id: event.target.value })
                  }
                >
                  <NativeSelectOption value="">历史年度预算</NativeSelectOption>
                  {versions.map((version) => (
                    <NativeSelectOption key={version.id} value={version.id}>
                      {version.id} · {version.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Label>
            </div>
          ) : dialog.kind === "edit" ? (
            <div className="grid gap-4">
              <Label>版本编码（YYYYMM）<Input value={form.id} maxLength="6" onChange={(event) => setForm({ ...form, id: event.target.value.replace(/\D/g, "") })} /></Label>
              <Label>版本名称<Input value={form.name} maxLength="100" onChange={(event) => setForm({ ...form, name: event.target.value })} /></Label>
            </div>
          ) : dialog.kind === "delete-warning" ? (
            <div className="grid gap-4">
              <p>该版本有 {dialog.info.submittedCount} 条提交记录。删除后业务用户将无法访问该版本，项目和提交记录保留供审计。</p>
              <Label className="flex items-center gap-2"><Checkbox checked={deleteAcknowledged} onCheckedChange={(checked) => setDeleteAcknowledged(checked === true)} />我已了解并确认删除该版本</Label>
            </div>
          ) : dialog.kind === "delete-confirm" ? (
            <p>确认删除版本 {dialog.version.id} · {dialog.version.name}？删除后版本将从业务列表移除，历史数据保留供审计。</p>
          ) : dialog.kind === "edit-confirm" ? (
            <>
              <p>确认将版本 {dialog.version.id} 修改为 {form.id} · {form.name}？</p>
              <p>修改版本保留原开放和部门确认状态，不改变已有分配。</p>
            </>
          ) : (
            <p>
              {dialog.kind === "close"
                ? "关闭后 Owner 不能修改或提交，各部门不能再提交或撤回。已有分配方案和提交记录保留。"
                : "开始后，本版本成为唯一开放提交的版本，其他版本自动关闭。已有方案和提交状态保持不变；已提交管理层的部门仍锁定。"}
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
