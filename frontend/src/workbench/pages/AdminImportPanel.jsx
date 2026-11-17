import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { WorkflowDialog } from "./WorkflowDialog";
import { useWorkbench } from "../WorkbenchContext";
import { exportExcelInWorker, previewExcelInWorker } from "../file-import";
import * as api from "../api";
import { validatePortalSession } from "../../portal/session";

const importErrorMessage = (failure, rows = []) =>
  String(failure.message || "导入失败，请检查后重试。").replace(
    /第\s*(\d+)\s*行/g,
    (match, index) =>
      rows[Number(index) - 1] ? `Excel第${rows[Number(index) - 1]}行` : match,
  );

export function AdminImportPanel({ kind }) {
  const { state, identity, previewMode, apiMode, refresh, notify } =
    useWorkbench();
  const [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(null),
    [error, setError] = useState("");
  const input = useRef(null),
    sequence = useRef(0);
  const version = state.planningVersion;
  const signature = JSON.stringify([
    identity?.email || identity?.key,
    identity?.role,
    previewMode,
    kind,
    version?.id,
    version?.revision,
  ]);
  const latest = useRef(signature);
  latest.current = signature;
  useEffect(() => {
    sequence.current += 1;
    setPreview(null);
    setError("");
    setBusy(false);
  }, [signature]);
  useEffect(
    () => () => {
      sequence.current += 1;
    },
    [],
  );
  const permitted =
    identity?.role === "admin" &&
    !previewMode &&
    apiMode &&
    (kind === "users" || Boolean(version));
  const title = kind === "users" ? "用户信息" : "Initiative归属";
  const context = {
    versionId: version?.id,
    initiatives: state.initiatives || [],
  };
  const check = (capture, request) => {
    if (latest.current !== capture || request !== sequence.current)
      throw Error("身份或规划版本已变化，请重新上传。");
  };
  const send = (payload) =>
    kind === "users"
      ? api.importAdminUsers(payload)
      : api.importVersionInitiatives(version.id, payload);
  async function download() {
    if (!permitted || busy) return;
    const capture = signature,
      request = ++sequence.current;
    setBusy(true);
    setError("");
    try {
      const bytes = await exportExcelInWorker(`admin-${kind}`, context);
      await validatePortalSession();
      check(capture, request);
      const url = URL.createObjectURL(
        new Blob([bytes], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `管理员_${title}_模板${kind === "initiatives" ? `_${version.id}` : ""}.xlsx`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      if (request === sequence.current) setError(failure.message);
    } finally {
      if (request === sequence.current) setBusy(false);
    }
  }
  async function upload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !permitted || busy) return;
    const capture = signature,
      request = ++sequence.current;
    let rowNumbers = [];
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      if (!/\.xlsx$/i.test(file.name)) throw Error("请选择 .xlsx 模板文件。");
      if (file.size > 10 * 1024 * 1024) throw Error("模板文件不能超过10MB。");
      const result = await previewExcelInWorker(
        `admin-${kind}`,
        await file.arrayBuffer(),
        context,
      );
      rowNumbers = result.rowNumbers || [];
      check(capture, request);
      const batch = { ...result, filename: file.name, capture, checked: false };
      setPreview(batch);
      if (!result.errors.length) {
        const expectedRevision =
          kind === "users"
            ? (await api.listAdminUsers({}, 1, 0)).revision
            : version.revision;
        check(capture, request);
        const payload = {
          expected_revision: expectedRevision,
          items: result.items,
        };
        const summary = await send({ ...payload, preview: true });
        check(capture, request);
        setPreview({ ...batch, payload, summary, checked: true });
      }
    } catch (failure) {
      if (request === sequence.current)
        setError(importErrorMessage(failure, rowNumbers));
    } finally {
      if (request === sequence.current) setBusy(false);
    }
  }
  async function confirm() {
    if (!preview?.checked || busy || !permitted) return;
    const request = ++sequence.current;
    setBusy(true);
    setError("");
    try {
      check(preview.capture, request);
      await send({ ...preview.payload, preview: false });
      check(preview.capture, request);
      setPreview(null);
      // The refreshed roles reload the users list; a second invalidation here
      // would repeat that request after the full workspace refresh.
      if (!await refresh({ preservePage: true })) {
        notify(`已导入 ${preview.items.length} 条${title}，但刷新失败，请重新加载后继续。`, true);
        return;
      }
      notify(`已导入 ${preview.items.length} 条${title}。`);
    } catch (failure) {
      if (request === sequence.current)
        setError(importErrorMessage(failure, preview.rowNumbers));
    } finally {
      if (request === sequence.current) setBusy(false);
    }
  }
  return (
    <>
      <Button
        variant="outline"
        type="button"
        disabled={!permitted || busy}
        onClick={download}
      >
        下载{title}模板
      </Button>
      <Button
        variant="outline"
        type="button"
        disabled={!permitted || busy}
        onClick={() => input.current?.click()}
      >
        {busy ? "处理中…" : `上传${title}`}
      </Button>
      <input
        ref={input}
        type="file"
        accept=".xlsx"
        aria-label={`上传${title}模板文件`}
        hidden
        onChange={upload}
      />
      {error && !preview && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {preview && (
        <WorkflowDialog
          wide
          title={`${title}导入预览`}
          busy={busy}
          onClose={() => {
            setPreview(null);
            setError("");
          }}
          onConfirm={confirm}
          disabled={!preview.checked || Boolean(preview.errors.length)}
          confirmLabel={`确认导入 ${preview.items.length} 条`}
        >
          <p>
            {preview.filename} · {preview.total}{" "}
            条记录。确认后整批写入；未列出的现有记录保持不变。
          </p>
          {kind === "initiatives" && (
            <p>
              目标版本：{version.id} · {version.name}
              。每行须填写变化原因；变更项目需重新提交，相关部门需重新确认。版本的发布与开放状态、经销商分配和历史提交快照保留。
            </p>
          )}
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {preview.errors.length > 0 && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>
                {preview.errors.slice(0, 100).map((item, index) => (
                  <p key={index}>
                    {item.row ? `第${item.row}行：` : ""}
                    {item.message}
                  </p>
                ))}
                {preview.errors.length > 100 && (
                  <p>共{preview.errors.length}处错误，显示前100处。</p>
                )}
              </AlertDescription>
            </Alert>
          )}
          {preview.checked && (
            <p role="status">
              服务端整批校验通过。
              {kind === "users" &&
                `新增 ${preview.summary.created} 人，更新 ${preview.summary.updated} 人。`}
              点击确认后保存。
            </p>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                {(kind === "users"
                  ? ["登录邮箱", "姓名", "角色", "授权范围", "所属组织", "状态"]
                  : [
                      "Initiative",
                      "归属",
                      "Owner",
                      "预算（元）",
                      "变化原因",
                    ]
                ).map((label) => (
                  <TableHead key={label}>{label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.items.slice(0, 100).map((item, index) => (
                <TableRow key={index}>
                  {(kind === "users"
                    ? [
                        item.email,
                        item.display_name,
                        item.role,
                        `${item.sector.join("、")} / ${item.department.join("、")}`,
                        `${item.affiliation_sector} / ${item.affiliation_department}`,
                        item.enabled ? "启用" : "停用",
                      ]
                    : [
                        item.name,
                        `${item.sector} / ${item.department} / ${item.resourceType}`,
                        item.ownerId,
                        item.budget.toLocaleString("zh-CN"),
                        item.reason,
                      ]
                  ).map((value, n) => (
                    <TableCell key={n}>{value}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {preview.items.length > 100 && (
            <p>预览显示前100条，确认会导入全部{preview.items.length}条。</p>
          )}
        </WorkflowDialog>
      )}
    </>
  );
}
