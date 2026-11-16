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
import { beijingDeadlineInput, versionStatus } from "./PlanningVersionBar.jsx";
export { beijingDeadlineInput } from "./PlanningVersionBar.jsx";
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

export function deadlineUpdate(version, input) {
  const date = input ? new Date(`${input}:00+08:00`) : null;
  if (date && !Number.isFinite(date.getTime()))
    throw new Error("请填写有效的北京时间");
  return {
    expected_revision: version.revision,
    deadline: date ? date.toISOString() : null,
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
    selectPlanningVersion,
    notify,
    previewMode,
    apiMode,
  } = useWorkbench();
  const versions = state.planningVersions || [];
  const displayedVersions = displayVersionOrder(versions);
  const [dialog, setDialog] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [deadlineError, setDeadlineError] = useState("");
  const [deleteAcknowledged, setDeleteAcknowledged] = useState(false);
  const [form, setForm] = useState({
    id: "",
    name: "",
    source_version_id: state.currentVersionId || "",
    deadline: "",
  });
  const open = (value) => {
    setError("");
    setDeadlineError("");
    setDialog(value);
  };
  const persist = async () => {
    setBusy(true);
    setError("");
    try {
      const changesCurrent = dialog.kind === "create" ||
        dialog.version?.id === (state.currentVersionId || state.planningVersion?.id);
      if (dialog.kind === "create") {
        await api.createPlanningVersion({
          id: form.id.trim(),
          name: form.name.trim(),
          ...(form.source_version_id
            ? { source_version_id: form.source_version_id }
            : {}),
          ...(form.deadline
            ? { deadline: deadlineUpdate({}, form.deadline).deadline }
            : {}),
        });
        api.setPlanningVersion(form.id.trim());
      } else if (dialog.kind === "edit-confirm") {
        await api.updatePlanningVersion(dialog.version.id, {
          ...deadlineUpdate(dialog.version, form.deadline),
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
          ...(dialog.kind === "open"
            ? {
                deadline: form.deadline
                  ? deadlineUpdate({}, form.deadline).deadline
                  : null,
              }
            : {}),
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
      setDeadlineError(failure.message);
    } finally {
      setBusy(false);
    }
  };
  const startDelete = async (version) => {
    setBusy(true);
    setDeadlineError("");
    try {
      const info = await api.planningVersionDeletionInfo(version.id);
      if (!info.canDelete) throw Error("请先关闭提交，再删除规划版本。");
      setDeleteAcknowledged(false);
      open({ kind: info.submittedCount ? "delete-warning" : "delete-confirm", version, info });
    } catch (failure) {
      setDeadlineError(failure.message || "无法检查版本，请刷新后重试。");
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
                <TableHead>提交截止时间（北京时间）</TableHead>
                <TableHead className="num">启用 Initiative</TableHead>
                <TableHead className="num">预算合计（万）</TableHead>
                <TableHead>发布 / 开放状态</TableHead>
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
                  <TableCell>
                    {beijingDeadlineInput(version.deadline)?.replace("T", " ") || "未设置"}
                  </TableCell>
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
                          setForm({ id: version.id, name: version.name, deadline: beijingDeadlineInput(version.deadline) });
                          open({ kind: "edit", version });
                        }}>编辑</Button>
                      <Button variant="destructive" size="sm" type="button"
                        disabled={previewMode || !apiMode || busy || (version.published && version.open)}
                        title={version.published && version.open ? "请先关闭提交" : "删除版本"}
                        onClick={() => startDelete(version)}>删除</Button>
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        disabled={busy}
                        onClick={() => selectPlanningVersion(version.id, { targetPage: "admin-initiatives" })}
                      >
                        配置项目
                      </Button>
                      {!version.published ? (
                        <Button
                          variant="default"
                          size="sm"
                          type="button"
                          disabled={previewMode || !apiMode || busy}
                          onClick={() => open({ kind: "publish", version })}
                        >
                          发布并开放
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          type="button"
                          disabled={previewMode || !apiMode || busy}
                          onClick={() => {
                            setForm((old) => ({
                              ...old,
                              deadline: beijingDeadlineInput(version.deadline),
                            }));
                            open({
                              kind: version.open ? "close" : "open",
                              version,
                            });
                          }}
                        >
                          {version.open ? "关闭提交" : "重新开放"}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!versions.length && (
                <TableRow>
                  <TableCell colSpan="8">
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
          启用项目数与预算合计只统计已加载版本；其他版本未加载时显示“—”，点击“配置项目”读取该版。
        </p>
      </Card>
      <p className="tiny">截止时间可留空；到期后停止修改、提交和部门撤回。到期不等于管理员关闭；所有部门提交齐全后才能关闭提交。</p>
      {deadlineError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{deadlineError}</AlertDescription>
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
            `${dialog.kind === "publish" ? "发布并开放" : dialog.kind === "close" ? "关闭提交" : "重新开放"} · ${dialog.version.name}`
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
            <div className="v19-form-grid">
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
              <Label>
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
              <Label>提交截止时间（北京时间，可留空）<Input type="datetime-local" value={form.deadline} onChange={(event) => setForm({ ...form, deadline: event.target.value })} /></Label>
            </div>
          ) : dialog.kind === "delete-warning" ? (
            <div className="grid gap-4">
              <p>该版本有 {dialog.info.submittedCount} 条提交记录。删除后业务用户将无法访问该版本，项目和提交记录保留供审计。</p>
              <Label className="flex items-center gap-2"><Checkbox checked={deleteAcknowledged} onCheckedChange={(checked) => setDeleteAcknowledged(checked === true)} />我已了解并确认删除该版本</Label>
            </div>
          ) : dialog.kind === "delete-confirm" ? (
            <p>确认删除版本 {dialog.version.id} · {dialog.version.name}？删除后版本将从业务列表移除，历史数据保留供审计。</p>
          ) : dialog.kind === "edit-confirm" ? (
            <p>确认将版本 {dialog.version.id} 修改为 {form.id} · {form.name}，截止时间为 {form.deadline ? form.deadline.replace("T", " ") + "（北京时间）" : "不设截止时间"}？</p>
          ) : (
            <p>
              {dialog.kind === "close"
                ? "所有部门提交齐全后才能关闭。关闭后 Owner 不能修改或提交，各部门不能再提交或撤回，已有方案保留为最终结果。"
                : "开放当前版本后，Owner 提交状态保持不变；已提交管理层的部门仍锁定，可由部门撤回提交后修改，或由管理员驳回并开放全部部门。"}
            </p>
          )}
          {["create", "open"].includes(dialog.kind) && (
            <Label>
              提交截止时间（北京时间，可选）
              <Input
                type="datetime-local"
                value={form.deadline}
                onChange={(event) =>
                  setForm({ ...form, deadline: event.target.value })
                }
              />
            </Label>
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
