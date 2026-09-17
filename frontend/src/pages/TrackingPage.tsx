import { useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Select,
} from "@fluentui/react-components";
import {
  ArrowRight,
  DownloadSimple,
  UploadSimple,
} from "@phosphor-icons/react";
import type { ColumnDef } from "@tanstack/react-table";
import { DEPARTMENTS } from "../domain/types";
import type {
  Allocation,
  Department,
  Quarter,
  TrackingRow,
} from "../domain/types";
import { formatMoney, formatPercent, trackingSummary } from "../domain/engine";
import { applyDataset, exportDataset, parseDataset } from "../domain/excel";
import { useWorkspace } from "../state/WorkspaceContext";
import {
  DataTable,
  EmptyState,
  MetricStrip,
  PageHeader,
  Panel,
  StatusBadge,
} from "../components/ui";

type DisplayRow = Allocation & {
  department: Department;
  initiative: string;
  record?: TrackingRow;
};
type ImportPreview = {
  rows: Record<string, unknown>[];
  errors: string[];
  count: number;
};

export function TrackingPage() {
  const { state, navigate, run, notify } = useWorkspace();
  const [versionId, setVersionId] = useState("");
  const [quarter, setQuarter] = useState<Quarter>("Q1");
  const [department, setDepartment] = useState<Department | "all">("all");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const version =
    state.versions.find((v) => v.id === versionId) ?? state.versions[0];
  const scope = department === "all" ? undefined : department;
  const snapshotState = version
    ? {
        ...state,
        budgets: version.budgets,
        allocations: version.allocations,
        forecast: version.forecast,
        versions: [
          version,
          ...state.versions.filter((v) => v.id !== version.id),
        ],
      }
    : state;
  const summary = version
    ? trackingSummary(state, version, quarter, scope)
    : null;
  const budgets =
    version?.budgets.filter((b) => !scope || b.department === scope) ?? [];
  const rows: DisplayRow[] = (version?.allocations ?? []).flatMap(
    (allocation) => {
      const budget = budgets.find((b) => b.id === allocation.initiativeId);
      return budget
        ? [
            {
              ...allocation,
              department: budget.department,
              initiative: budget.name,
              record: state.tracking.find(
                (t) =>
                  t.initiativeId === allocation.initiativeId &&
                  t.distributor === allocation.distributor &&
                  t.quarter === quarter,
              ),
            },
          ]
        : [];
    },
  );
  const columns: ColumnDef<DisplayRow, unknown>[] = [
    { accessorKey: "distributor", header: "Distributor" },
    { accessorKey: "department", header: "部门" },
    { accessorKey: "initiative", header: "Initiative" },
    {
      accessorKey: "amount",
      header: "已分配预算",
      cell: (x) => (
        <span className="numeric">{formatMoney(x.row.original.amount)}</span>
      ),
    },
    {
      id: "actual",
      header: `${quarter} 实际 YTD`,
      cell: (x) =>
        x.row.original.record ? (
          <span className="numeric">
            {formatMoney(x.row.original.record.actualSpendYtd)}
          </span>
        ) : (
          <StatusBadge tone="warning">待导入</StatusBadge>
        ),
    },
    {
      id: "remaining",
      header: "剩余预算",
      cell: (x) =>
        x.row.original.record ? (
          <span className="numeric">
            {formatMoney(
              x.row.original.amount - x.row.original.record.actualSpendYtd,
            )}
          </span>
        ) : (
          "未提供"
        ),
    },
    {
      id: "forecast",
      header: "全年预测",
      cell: (x) =>
        x.row.original.record?.forecastSpend != null ? (
          <span className="numeric">
            {formatMoney(x.row.original.record.forecastSpend)}
          </span>
        ) : (
          <span className="muted">未提供</span>
        ),
    },
    {
      id: "variance",
      header: "预测差异",
      cell: (x) => {
        const row = x.row.original;
        return row.record?.forecastSpend != null ? (
          <span className="numeric">
            {formatMoney(row.record.forecastSpend - row.amount)}
          </span>
        ) : (
          "未提供"
        );
      },
    },
    {
      id: "reason",
      header: "差异说明",
      cell: (x) => x.row.original.record?.reason || "未提供",
    },
  ];
  async function exportTracking() {
    setBusy(true);
    try {
      const scopedIds = new Set(budgets.map((b) => b.id));
      await exportDataset(
        {
          ...snapshotState,
          tracking: state.tracking.filter(
            (r) => r.quarter === quarter && scopedIds.has(r.initiativeId),
          ),
        },
        "tracking",
        { department: scope },
      );
      notify(`已导出 ${version?.name} · ${quarter} Tracking 工作簿`, "success");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "导出失败，请重试",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }
  async function importTracking(file: File) {
    setBusy(true);
    try {
      const result = await parseDataset(file, "tracking", snapshotState, {
        department: scope,
      });
      if (
        scope &&
        result.rows.some((row) => String(row.Department).trim() !== scope)
      )
        result.errors.push(
          `文件包含其他部门，请切换到全部部门或仅导入 ${scope} 记录。`,
        );
      setPreview(result);
    } catch (error) {
      notify(error instanceof Error ? error.message : "文件读取失败", "error");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  return (
    <div className="page-stack">
      <PageHeader
        title="季度 Tracking"
        description="以正式提交的预算为基线，跟踪实际使用与全年预测。"
        actions={
          version ? (
            <>
              <Button
                icon={<DownloadSimple />}
                disabled={busy}
                onClick={() => void exportTracking()}
              >
                导出 Tracking
              </Button>
              <Button
                appearance="primary"
                icon={<UploadSimple />}
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                导入 Tracking
              </Button>
            </>
          ) : undefined
        }
      />
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx"
        hidden
        aria-label="导入 Tracking Excel"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importTracking(file);
        }}
      />
      {!version || !summary ? (
        <Panel>
          <EmptyState
            title="先建立预算基线"
            description="完成部门确认并发布正式版本后，即可导入季度实际数据。"
            action={
              <Button
                appearance="primary"
                icon={<ArrowRight />}
                iconPosition="after"
                onClick={() => navigate("submit")}
              >
                前往确认与提交
              </Button>
            }
          />
        </Panel>
      ) : (
        <>
          <div className="toolbar">
            <Field label="预算基线">
              <Select
                value={version.id}
                onChange={(_, data) => setVersionId(data.value)}
              >
                {state.versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="追踪季度">
              <Select
                value={quarter}
                onChange={(_, data) => setQuarter(data.value as Quarter)}
              >
                {(["Q1", "Q2", "Q3", "Q4"] as const).map((q) => (
                  <option key={q}>{q}</option>
                ))}
              </Select>
            </Field>
            <Field label="部门">
              <Select
                value={department}
                onChange={(_, data) =>
                  setDepartment(data.value as Department | "all")
                }
              >
                <option value="all">全部部门</option>
                {DEPARTMENTS.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </Select>
            </Field>
            <StatusBadge tone="neutral">
              {new Date(version.createdAt).toLocaleDateString("zh-CN")} 提交
            </StatusBadge>
          </div>
          <MetricStrip
            items={[
              {
                label: "正式预算",
                value: formatMoney(summary.budget),
                hint: `含待分配池 ${formatMoney(summary.pool)}`,
              },
              {
                label: "实际支出 YTD",
                value: formatMoney(summary.actual),
                hint: `截至 ${quarter} 的累计实际`,
              },
              {
                label: "剩余预算",
                value: formatMoney(summary.remaining),
                hint: "正式预算 − 已有实际",
                tone: summary.remaining < 0 ? "red" : undefined,
              },
              {
                label: "预算使用率",
                value:
                  summary.utilization == null
                    ? "未提供"
                    : formatPercent(summary.utilization),
                hint: "实际 YTD / 正式预算",
              },
              {
                label: "全年预测",
                value:
                  summary.forecast == null
                    ? "未提供"
                    : formatMoney(summary.forecast),
                hint: "来自导入的全年预测值",
              },
              {
                label: "预测差异",
                value:
                  summary.variance == null
                    ? "未提供"
                    : formatMoney(summary.variance),
                hint: "全年预测 − 正式预算",
                tone: (summary.variance ?? 0) > 0 ? "red" : undefined,
              },
            ]}
          />
          <div className="notice">
            当前显示 {quarter} 的 YTD
            快照，不累加不同季度。切换版本仅改变预算基线，实际记录按
            Initiative、Distributor 和季度匹配。
          </div>
          {summary.missing > 0 && (
            <div className="notice notice-warning">
              {summary.missing}{" "}
              条分配记录缺少本季度实际。实际与剩余指标仅依据已导入记录，请补齐后判断使用进度；缺失不代表零支出。
            </div>
          )}
          <Panel
            title="预算执行明细"
            description={`${rows.length} 条经销商分配记录 · 金额单位：元`}
          >
            <DataTable
              columns={columns}
              data={rows}
              emptyText="所选部门在该版本中没有已分配记录。"
              caption={`${version.name} · ${quarter} 预算执行`}
            />
            <p className="table-note">
              明细预算为经销商已分配金额；顶部正式预算包含待分配池。正向预测差异表示预测支出超过预算。
            </p>
          </Panel>
          <Panel title="C3 与 Yield 口径">
            <p className="muted">
              预计 C3 保留在经销商层级，不复制到各个 Initiative。实际 C3
              的财务归属粒度尚未确认，本页面暂不计算项目级 Yield，以免重复归因。
            </p>
          </Panel>
        </>
      )}
      <Dialog
        open={preview !== null}
        onOpenChange={(_, data) => {
          if (!data.open) setPreview(null);
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Tracking 导入预览</DialogTitle>
            <DialogContent>
              <div className="page-stack">
                <p>
                  识别到 {preview?.count ?? 0}{" "}
                  条记录。确认后按项目、经销商和季度更新对应的 YTD 记录。
                </p>
                {preview?.errors.length ? (
                  <div className="notice notice-danger">
                    <strong>请修正以下问题后重新导入</strong>
                    <ul>
                      {preview.errors.slice(0, 12).map((error, i) => (
                        <li key={i}>{error}</li>
                      ))}
                    </ul>
                    {preview.errors.length > 12 && (
                      <p>另有 {preview.errors.length - 12} 项错误。</p>
                    )}
                  </div>
                ) : (
                  <div className="notice">
                    校验通过。本次导入会更新实际数据，不会修改正式预算快照。
                  </div>
                )}
              </div>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setPreview(null)}>取消</Button>
              <Button
                appearance="primary"
                disabled={
                  !preview || preview.errors.length > 0 || preview.count === 0
                }
                onClick={() => {
                  if (
                    preview &&
                    version &&
                    run((s) => {
                      const imported = applyDataset(
                        {
                          ...s,
                          versions: [
                            version,
                            ...s.versions.filter((v) => v.id !== version.id),
                          ],
                        },
                        "tracking",
                        preview.rows,
                        { department: scope },
                      );
                      const key = (r: TrackingRow) =>
                        JSON.stringify([
                          r.initiativeId,
                          r.distributor,
                          r.quarter,
                        ]);
                      const importedKeys = new Set(imported.tracking.map(key));
                      return {
                        ...s,
                        dataMode: "user",
                        tracking: [
                          ...s.tracking.filter(
                            (r) => !importedKeys.has(key(r)),
                          ),
                          ...imported.tracking,
                        ],
                      };
                    }, "季度 Tracking 已更新")
                  )
                    setPreview(null);
                }}
              >
                确认导入
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
