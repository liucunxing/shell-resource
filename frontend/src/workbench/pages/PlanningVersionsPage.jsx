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

export function beijingDeadlineInput(value) {
  if (!value) return "";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 16)
    : "";
}

export function deadlineUpdate(version, input, now = Date.now()) {
  const date = input ? new Date(`${input}:00+08:00`) : null;
  if (date && !Number.isFinite(date.getTime()))
    throw new Error("请填写有效的北京时间");
  return {
    expected_revision: version.revision,
    deadline: date ? date.toISOString() : null,
    ...(version.open && date && date.getTime() <= now ? { open: false } : {}),
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
    selectPlanningVersion,
    navigate,
    notify,
    previewMode,
    apiMode,
  } = useWorkbench();
  const versions = state.planningVersions || [];
  const displayedVersions = displayVersionOrder(versions);
  const [dialog, setDialog] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [deadlineDrafts, setDeadlineDrafts] = useState({});
  const [deadlineError, setDeadlineError] = useState("");
  const [form, setForm] = useState({
    id: "",
    name: "",
    source_version_id: state.currentVersionId || "",
    deadline: "",
  });
  const open = (value) => {
    setError("");
    setDialog(value);
  };
  const persist = async () => {
    setBusy(true);
    setError("");
    try {
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
      } else {
        await api.updatePlanningVersion(dialog.version.id, {
          expected_revision: dialog.version.revision,
          ...(dialog.kind === "publish"
            ? { published: true, open: true }
            : dialog.kind === "withdraw"
              ? { published: false, open: false }
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
      await refresh({ preservePage: true });
      notify("规划版本已保存。");
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };
  const saveDeadline = async (version) => {
    setBusy(true);
    setDeadlineError("");
    try {
      const value =
        deadlineDrafts[version.id] ?? beijingDeadlineInput(version.deadline);
      await api.updatePlanningVersion(
        version.id,
        deadlineUpdate(version, value),
      );
      await refresh({ preservePage: true });
      setDeadlineDrafts((drafts) => {
        const next = { ...drafts };
        delete next[version.id];
        return next;
      });
      notify("提交截止时间已保存。");
    } catch (failure) {
      setDeadlineError(failure.message || "提交截止时间保存失败，请重试。");
    } finally {
      setBusy(false);
    }
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
                    <div className="actions">
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        onClick={async () => {
                          if (await selectPlanningVersion(version.id))
                            navigate("admin-initiatives");
                        }}
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
                      {version.published && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={previewMode || !apiMode || busy}
                          onClick={() => open({ kind: "withdraw", version })}
                        >
                          撤回发布
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!versions.length && (
                <TableRow>
                  <TableCell colSpan="6">
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
      <Card className="panel studio-admin-panel gap-4 p-4">
        <div className="panel-header">
          <div>
            <h2>提交截止时间</h2>
            <p>
              按北京时间设置，可留空。截止后停止修改与提交；设置已到期时间会同步关闭提交，清空时间不会自动重新开放。
            </p>
          </div>
        </div>
        {displayedVersions.map((version) => (
          <div
            key={version.id}
            className="flex flex-wrap items-center justify-between gap-4 border-b border-border py-3 last:border-0"
          >
            <div>
              <strong>{version.id}</strong>
              <div className="small-text muted">{version.name}</div>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Label className="grid gap-2">
                截止时间（北京时间，可留空）
                <Input
                  type="datetime-local"
                  aria-label={`${version.id} 提交截止时间（北京时间）`}
                  value={
                    deadlineDrafts[version.id] ??
                    beijingDeadlineInput(version.deadline)
                  }
                  disabled={previewMode || !apiMode || busy}
                  onChange={(event) =>
                    setDeadlineDrafts((drafts) => ({
                      ...drafts,
                      [version.id]: event.target.value,
                    }))
                  }
                />
              </Label>
              <span className="small-text muted">{versionStatus(version)}</span>
              <Button
                variant="outline"
                size="sm"
                disabled={
                  previewMode ||
                  !apiMode ||
                  busy ||
                  deadlineDrafts[version.id] === undefined ||
                  deadlineDrafts[version.id] ===
                    beijingDeadlineInput(version.deadline)
                }
                onClick={() => saveDeadline(version)}
              >
                保存截止时间
              </Button>
            </div>
          </div>
        ))}
        {deadlineError && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{deadlineError}</AlertDescription>
          </Alert>
        )}
      </Card>
      {dialog && (
        <WorkflowDialog
          title={
            dialog.kind === "create"
              ? "创建规划版本"
              : `${dialog.kind === "publish" ? "发布并开放" : dialog.kind === "close" ? "关闭提交" : dialog.kind === "withdraw" ? "撤回发布" : "重新开放"} · ${dialog.version.name}`
          }
          busy={busy}
          onClose={() => setDialog(null)}
          onConfirm={persist}
          disabled={
            dialog.kind === "create" &&
            (!/^20\d{2}(0[1-9]|1[0-2])$/.test(form.id) || !form.name.trim())
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
          ) : (
            <p>
              {dialog.kind === "close"
                ? "关闭后所有 Owner 停止编辑和提交。已提交、已确认方案保留。"
                : dialog.kind === "withdraw"
                  ? "撤回发布并关闭提交后，业务角色将不可访问该版本。配置和已提交方案保留，重新发布后恢复可见。"
                  : "开放当前版本后，其他版本关闭编辑。Owner 提交状态保持不变；需修改的项目应由部门负责人退回。"}
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
