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
    ? "待重新提交"
    : item.workflow?.submitted
      ? "已提交"
      : "未提交";
}

export function combineDepartmentReviews(results, current) {
  if (new Set(results.map((item) => item.version.revision)).size > 1)
    throw Error("各部门状态在加载期间发生变化，请重试。");
  return {
    version: results[0]?.version || current,
    submitted: results.reduce((sum, item) => sum + (item.submitted || 0), 0),
    total: results.reduce((sum, item) => sum + (item.total || 0), 0),
    confirmed: results.length > 0 && results.every((item) => item.total > 0 && item.confirmed === item.total),
    items: results.flatMap((item) => item.items || []),
  };
}

export function departmentWindowOpen(version) {
  return Boolean(version?.published && version.open);
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
  const allScopes = scope === "__all__" && identity.role === "admin";
  const scopeKey = allScopes ? scope : scopes.some(([key]) => key === scope)
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
  const fetchReview = async () => {
    if (!allScopes) return api.departmentReview(current.id, selectedScope.sector, selectedScope.department);
    const results = await Promise.all(scopes.map(([, item]) =>
      api.departmentReview(current.id, item.sector, item.department)));
    return combineDepartmentReviews(results, current);
  };
  const load = async () => {
    if (!current || (!selectedScope && !allScopes)) return;
    setLoading(true);
    setError("");
    try {
      setResult(await fetchReview());
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
    if (!apiMode || !current || (!selectedScope && !allScopes)) return;
    setLoading(true);
    fetchReview()
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
    return <div className="empty">仅部门负责人和管理员可查看部门方案。</div>;
  const windowOpen = departmentWindowOpen(result?.version || current);
  const items = [...(result?.items || [])].sort((a, b) => {
    const value = (item) => ({
      status: reviewStatus(item), confirmed: item.workflow?.confirmed ? "已提交管理层" : "未提交管理层",
      revision: item.workflow?.submittedRevision, submittedAt: item.workflow?.submittedAt || item.publishedAt,
      allocated: item.workflow?.submitted ? E.totals([item]).allocated : null,
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
  const start = (action) => {
    setReason("");
    setError("");
    setDialog({ action });
  };
  const act = async () => {
    setBusy(true);
    setError("");
    try {
      if (dialog.action === "release") {
        await api.releasePlanningVersion(current.id, {
          expected_revision: (result?.version || current).revision,
          reason: reason.trim(),
        });
      } else {
        if (!departmentWindowOpen(result?.version || current))
          throw Error("当前版本已关闭，不能提交或撤回部门方案。");
        await api.reviewDepartment(current.id, dialog.action, {
          ...selectedScope,
          expected_revision: result.version.revision,
          ...(dialog.action === "withdraw" ? { reason: reason.trim() } : {}),
        });
      }
      setDialog(null);
      // The refreshed version revision triggers the status effect once.
      // Calling load() here also would issue a duplicate status request.
      if (!await refresh({ preservePage: true })) {
        notify("操作已保存，但刷新失败，请重新加载后继续。", true);
        return;
      }
      notify(
        dialog.action === "confirm"
          ? "部门方案已提交管理层。"
          : dialog.action === "withdraw"
            ? "已撤回部门提交，当前部门全部 Owner 可直接修改，已有提交保留。"
            : "已驳回并开放当前版本全部部门。",
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
        title={identity.role === "admin" ? "部门方案与驳回" : "部门方案提交"}
        description="核对 Owner 提交情况后，统一提交管理层；版本开放时可撤回修改。"
      />
      <PlanningVersionBar
        scope={
          scopes.length <= 1 && selectedScope
            ? `${selectedScope.sector} / ${selectedScope.department}`
            : ""
        }
      >
        {current && scopes.length > 1 && (
          <Label className="v19-scope-label">
            查看范围
            <NativeSelect
              value={scopeKey}
              onChange={(event) => setScope(event.target.value)}
            >
              {identity.role === "admin" && <NativeSelectOption value="__all__">全部</NativeSelectOption>}
              {scopes.map(([key, item]) => (
                <NativeSelectOption key={key} value={key}>
                  {item.sector} · {item.department}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Label>
        )}
      </PlanningVersionBar>
      {!current ? (
        <div className="empty">请由管理员创建并发布规划版本。</div>
      ) : (
        <>
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
                  {allScopes ? "全部部门提交情况" : result?.confirmed ? "部门已提交管理层" : "部门尚未提交管理层"}
                </h2>
                <p>
                  {loading
                    ? "正在加载提交状态…"
                    : allScopes ? `${result?.submitted || 0} / ${result?.total || 0} 项已提交` : `${result?.submitted || 0} / ${result?.total || 0} 项已提交 · ${result?.confirmed ? "部门已提交管理层" : "部门未提交管理层"}`}
                </p>
              </div>
              <div className="actions">
                {identity.role === "admin" ? (
                  <Button variant="outline"
                    disabled={previewMode || !apiMode || busy || loading || !current.published}
                    onClick={() => start("release")}>
                    驳回并开放全部部门
                  </Button>
                ) : (
                  <>
                    <Button disabled={previewMode || !apiMode || busy || loading || !windowOpen || !result?.canConfirm}
                      onClick={() => start("confirm")}>
                      提交部门方案至管理层
                    </Button>
                    <Button variant="outline"
                      disabled={previewMode || !apiMode || busy || loading || !windowOpen || !result?.canWithdraw}
                      onClick={() => start("withdraw")}>
                      撤回部门提交
                    </Button>
                  </>
                )}
              </div>
            </div>
            <p className="studio-table-note">
              部门提交前 Owner 可直接修改；撤回部门提交后，当前部门全部 Owner 恢复编辑，已有提交保留。
              保存修改后须重新提交，未修改的项目无需重复提交。管理员关闭版本后，部门不能再提交或撤回。
              {identity.role === "admin" && " 管理员驳回会开放当前版本全部部门，不受查看范围限制，。"}
            </p>
            <div className="table-scroll v20-review-scroll">
              <Table sortingMode="manual" containerClassName="overflow-visible">
                <TableHeader>
                  <TableRow>
                    {[["name", "Initiative"], ...(allScopes ? [["sector", "业务线"], ["department", "部门"]] : []), ["ownerId", "Owner"], ["status", "Owner 提交状态"], ["confirmed", "部门提交状态"], ["revision", "提交版本"], ["submittedAt", "提交时间"], ["allocated", "分配金额（元）"]].map(([key,label]) => (
                      <TableHead key={key} aria-sort={sort.key === key ? (sort.direction === 1 ? "ascending" : "descending") : "none"}>
                        <Button variant="ghost" type="button" className="v19-sort" onClick={() => sortBy(key)}>{label}{sort.key === key ? (sort.direction === 1 ? " ↑" : " ↓") : " ↕"}</Button>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <strong>{item.name}</strong>
                      </TableCell>
                      {allScopes && <><TableCell>{item.sector}</TableCell><TableCell>{item.department}</TableCell></>}
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
                        {item.workflow?.confirmed ? "已提交管理层" : "未提交管理层"}
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
                    </TableRow>
                  ))}
                  {!loading && !items.length && (
                    <TableRow>
                      <TableCell colSpan={allScopes ? 9 : 7}>
                        <div className="empty">当前范围没有启用项目。</div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </>
      )}
      {dialog && (
        <WorkflowDialog
          title={dialog.action === "release" ? "驳回并开放全部部门" :
            dialog.action === "confirm" ? "提交部门方案至管理层" : "撤回部门提交"}
          busy={busy}
          onClose={() => setDialog(null)}
          onConfirm={act}
          confirmLabel={dialog.action === "release" ? "确认驳回并全部开放" : "确认"}
          disabled={dialog.action !== "confirm" && !reason.trim()}
        >
          <p>
            {dialog.action === "confirm"
              ? `将当前部门范围的 ${result.total} 个项目提交管理层，并锁定 Owner 编辑。`
              : dialog.action === "withdraw"
                ? "撤回当前部门提交后，管理层不再看到该部门分配；本部门全部 Owner 立即恢复编辑，已有提交保留。"
                : `将驳回版本 ${current.id} · ${current.name} 的全部部门方案，并一键恢复所有 Owner 编辑。本版本将成为唯一开放版本，其他版本自动停用，已有方案和提交记录保留。管理层在各部门重新提交前不展示本版本相应分配。此操作不受当前查看范围限制。`}
          </p>
          {dialog.action !== "confirm" && (
            <Label>
              原因（必填）
              <Textarea rows="3" maxLength="160" value={reason}
                onChange={(event) => setReason(event.target.value)} />
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
