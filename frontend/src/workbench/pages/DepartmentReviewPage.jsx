import { Alert, AlertDescription } from "../../components/ui/alert";
import { Label } from "../../components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "../../components/ui/native-select";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
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
import { useEffect, useMemo, useState } from "react";
import * as api from "../api.js";
import { useWorkbench } from "../WorkbenchContext.jsx";
import E from "../domain/engine.js";
import { PageHead } from "./OverviewPages.jsx";
import { PlanningVersionBar } from "./PlanningVersionBar.jsx";
import { WorkflowDialog } from "./WorkflowDialog.jsx";

const money = (value) =>
  Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const stamp = (value) =>
  value ? new Date(value).toLocaleString("zh-CN") : "—";
export function reviewStatus(item) {
  return item.workflow?.requiresResubmission
    ? "退回待重提"
    : item.workflow?.submitted
      ? "已提交"
      : "未提交";
}

export function DepartmentReviewPage() {
  const { state, identity, refresh, notify, previewMode, apiMode } =
    useWorkbench();
  const scopes = useMemo(
    () => [
      ...new Map(
        (state.initiatives || []).map((item) => [
          `${item.sector}|${item.department}`,
          { sector: item.sector, department: item.department },
        ]),
      ).entries(),
    ],
    [state.initiatives],
  );
  const [scope, setScope] = useState("");
  const scopeKey = scopes.some(([key]) => key === scope)
    ? scope
    : scopes[0]?.[0] || "";
  const selectedScope = scopes.find(([key]) => key === scopeKey)?.[1];
  const [result, setResult] = useState(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const [dialog, setDialog] = useState(null),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false);
  const [sort, setSort] = useState({ key: "name", direction: 1 });
  const current = state.planningVersion;
  const load = async () => {
    if (!current || !selectedScope) return;
    setLoading(true);
    setError("");
    try {
      setResult(
        await api.departmentReview(
          current.id,
          selectedScope.sector,
          selectedScope.department,
        ),
      );
    } catch (failure) {
      setError(failure.message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    let live = true;
    setResult(null);
    setError("");
    if (!apiMode || !current || !selectedScope) return;
    setLoading(true);
    api
      .departmentReview(
        current.id,
        selectedScope.sector,
        selectedScope.department,
      )
      .then((value) => {
        if (live) setResult(value);
      })
      .catch((failure) => {
        if (live) setError(failure.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [apiMode, current?.id, current?.revision, scopeKey]);
  if (!["lead", "admin"].includes(identity.role))
    return <div className="empty">仅部门负责人可确认部门方案。</div>;
  const items = [...(result?.items || [])].sort((a, b) => {
    const value = (item) => ({
      status: reviewStatus(item), confirmed: item.workflow?.confirmed ? "已确认" : "未确认",
      revision: item.workflow?.submittedRevision, submittedAt: item.workflow?.submittedAt || item.publishedAt,
      allocated: item.workflow?.submitted ? E.totals([item]).allocated : null,
      returnReason: item.workflow?.returnReason,
    })[sort.key] ?? item[sort.key] ?? "";
    return (
      String(value(a)).localeCompare(String(value(b)), "zh-CN", {
        numeric: true,
      }) * sort.direction
    );
  });
  const sortBy = (key) =>
    setSort((old) => ({
      key,
      direction: old.key === key ? -old.direction : 1,
    }));
  const start = (action, target = {}) => {
    setReason("");
    setError("");
    setDialog({ action, ...target });
  };
  const act = async () => {
    setBusy(true);
    setError("");
    try {
      await api.reviewDepartment(current.id, dialog.action, {
        ...selectedScope,
        expected_revision: result.version.revision,
        ...(dialog.action !== "confirm" ? { reason: reason.trim() } : {}),
        ...(dialog.initiative
          ? { initiative_id: Number(dialog.initiative.id) }
          : {}),
        ...(dialog.owner ? { owner_email: dialog.owner } : {}),
      });
      setDialog(null);
      await refresh({ preservePage: true });
      await load();
      notify(
        dialog.action === "confirm"
          ? "部门方案已统一确认。"
          : dialog.action === "withdraw"
            ? "已撤回部门确认，Owner 提交仍保留。"
            : "所选范围已退回，等待 Owner 重新提交。",
      );
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHead
        eyebrow="DEPARTMENT CONFIRMATION"
        title="确认部门方案"
        description="先核对每个 Owner 与 Initiative 的提交情况，再统一确认。"
      />
      <PlanningVersionBar
        scope={
          selectedScope
            ? `${selectedScope.sector} / ${selectedScope.department}`
            : ""
        }
      />
      {!current ? (
        <div className="empty">请由管理员创建并发布规划版本。</div>
      ) : (
        <>
          {scopes.length > 1 && (
            <Label className="v19-scope-label">
              确认范围
              <NativeSelect
                value={scopeKey}
                onChange={(event) => setScope(event.target.value)}
              >
                {scopes.map(([key, item]) => (
                  <NativeSelectOption key={key} value={key}>
                    {item.sector} · {item.department}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Label>
          )}
          {error && !dialog && (
            <Alert variant="destructive" className="note-box warn" role="alert">
              <AlertDescription>
                {error}
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={load}
                >
                  重试
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <Card className="panel studio-admin-panel gap-4 p-4">
            <div className="panel-header">
              <div>
                <h2>
                  {result?.confirmed ? "部门方案已确认" : "部门方案未确认"}
                </h2>
                <p>
                  {loading
                    ? "正在加载提交状态…"
                    : `${result?.submitted || 0} / ${result?.total || 0} 项已提交 · ${result?.confirmed ? "部门已确认" : "部门未确认"}`}
                </p>
              </div>
              <div className="actions">
                <Button
                  disabled={
                    previewMode ||
                    busy ||
                    !result?.canConfirm ||
                    result?.confirmed
                  }
                  onClick={() => start("confirm")}
                >
                  统一确认部门方案
                </Button>
                <Button
                  variant="outline"
                  disabled={previewMode || busy || !result?.confirmed}
                  onClick={() => start("withdraw")}
                >
                  撤回部门确认
                </Button>
                <Button
                  variant="outline"
                  disabled={
                    previewMode ||
                    busy ||
                    result?.confirmed ||
                    !result?.submitted
                  }
                  onClick={() => start("return")}
                >
                  退回全部 Owner，开放修改
                </Button>
              </div>
            </div>
            {
              <p className="studio-table-note">
                仅撤回部门确认：Owner 保持“已提交”，可以直接再次确认。退回指定
                Initiative 或 Owner 后，仅对应项目变为“未确认 ·
                待重新提交”，其余 Owner
                不受影响。所有项目重新提交齐全后，才能统一确认。
              </p>
            }
            <div className="table-scroll v20-review-scroll">
              <Table containerClassName="overflow-visible">
                <TableHeader>
                  <TableRow>
                    {[["name", "Initiative"], ["ownerId", "Owner"], ["status", "Owner 提交状态"], ["confirmed", "部门确认状态"], ["revision", "提交版本"], ["submittedAt", "提交时间"], ["allocated", "分配金额（元）"], ["returnReason", "退回原因"]].map(([key,label]) => (
                      <TableHead key={key} aria-sort={sort.key === key ? (sort.direction === 1 ? "ascending" : "descending") : "none"}>
                        <Button variant="ghost" type="button" className="v19-sort" onClick={() => sortBy(key)}>{label}{sort.key === key ? (sort.direction === 1 ? " ↑" : " ↓") : " ↕"}</Button>
                      </TableHead>
                    ))}
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <strong>{item.name}</strong>
                        <small>{item.initiativeKey || item.id}</small>
                      </TableCell>
                      <TableCell>{item.ownerLabel || item.ownerId}</TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={`resource-status ${item.workflow?.submitted ? "done" : "editing"}`}
                        >
                          {reviewStatus(item)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {item.workflow?.confirmed ? "已确认" : "未确认"}
                      </TableCell>
                      <TableCell>
                        {item.workflow?.submittedRevision != null
                          ? `r${item.workflow.submittedRevision}`
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {stamp(item.workflow?.submittedAt || item.publishedAt)}
                      </TableCell>
                      <TableCell className="num">
                        {item.workflow?.submitted
                          ? money(E.totals([item]).allocated)
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {item.workflow?.returnReason || "—"}
                      </TableCell>
                      <TableCell>
                        <div className="actions">
                          <Button
                            variant="outline"
                            size="sm"
                            type="button"
                            disabled={
                              previewMode ||
                              result.confirmed ||
                              !item.workflow?.submitted
                            }
                            onClick={() =>
                              start("return", { initiative: item })
                            }
                          >
                            退回该 Initiative
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!loading && !items.length && (
                    <TableRow>
                      <TableCell colSpan="9">
                        <div className="empty">当前范围没有启用项目。</div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
          <Card className="panel v19-owner-return-panel">
            <h2>按 Owner 开放修改</h2>
            <div className="v19-owner-return-grid">
              {[...new Set(items.map((i) => i.ownerId))].map((owner) => {
                const own = items.filter((i) => i.ownerId === owner),
                  submitted = own.filter(
                    (i) =>
                      i.workflow?.submitted &&
                      !i.workflow?.requiresResubmission,
                  ).length;
                return (
                  <Card key={owner}>
                    <b>{own[0]?.ownerLabel || owner}</b>
                    <p>
                      已提交 {submitted} / {own.length} 个 Initiative
                    </p>
                    <Button
                      variant="outline"
                      disabled={
                        previewMode || busy || result?.confirmed || !submitted
                      }
                      onClick={() => start("return", { owner })}
                    >
                      退回该 Owner，开放修改
                    </Button>
                  </Card>
                );
              })}
            </div>
            <p className="muted">
              已确认时请先撤回部门确认。退回按当前部门、当前版本进行，不影响该
              Owner 在其他部门或版本的项目。
            </p>
          </Card>
        </>
      )}
      {dialog && (
        <WorkflowDialog
          title={
            dialog.action === "confirm"
              ? "统一确认部门方案"
              : dialog.action === "withdraw"
                ? "撤回部门确认"
                : "退回方案"
          }
          busy={busy}
          onClose={() => setDialog(null)}
          onConfirm={act}
          disabled={dialog.action !== "confirm" && !reason.trim()}
        >
          <p>
            {dialog.action === "confirm"
              ? `将确认完整部门范围的 ${result.total} 个项目，单个项目筛选不会改变确认范围。`
              : dialog.action === "withdraw"
                ? "仅撤回部门确认与管理层可见性，保留全部 Owner 提交。未退回项目可直接再次统一确认。"
                : dialog.initiative
                  ? `仅退回 ${dialog.initiative.name}；同一 Owner 的其他项目保持提交。`
                  : dialog.owner
                    ? `退回 ${dialog.owner} 在当前部门范围的项目；其他 Owner 保持提交。`
                    : "退回当前部门范围全部已提交项目。"}
          </p>
          {dialog.action !== "confirm" && (
            <Label>
              原因（必填）
              <Textarea
                rows="3"
                maxLength="160"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </Label>
          )}
          {error && (
            <Alert variant="destructive" role="alert" className="note-box warn">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </WorkflowDialog>
      )}
    </>
  );
}
