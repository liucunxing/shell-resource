import { useState } from "react";
import { Button, Field, Select, Textarea } from "@fluentui/react-components";
import { ArrowRight, DownloadSimple, SealCheck } from "@phosphor-icons/react";
import type { ColumnDef } from "@tanstack/react-table";
import { DEPARTMENTS } from "../domain/types";
import type { Budget, Department } from "../domain/types";
import { formatMoney, publishVersion, totals } from "../domain/engine";
import { exportDataset } from "../domain/excel";
import { useWorkspace } from "../state/WorkspaceContext";
import {
  DataTable,
  EmptyState,
  MetricStrip,
  PageHeader,
  Panel,
  StatusBadge,
} from "../components/ui";

export function SubmitPage() {
  const { state, setDepartment, navigate, run, notify } = useWorkspace();
  const [note, setNote] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [exportDepartment, setExportDepartment] = useState<Department>("MKT");
  const activeDepartments = DEPARTMENTS.filter((d) =>
    state.budgets.some((b) => b.department === d),
  );
  const ready =
    activeDepartments.length > 0 &&
    activeDepartments.every((d) => state.confirmed[d]);
  const summary = totals(state);
  const selected =
    state.versions.find((v) => v.id === selectedId) ?? state.versions[0];
  const columns: ColumnDef<Budget, unknown>[] = [
    { accessorKey: "department", header: "部门" },
    { accessorKey: "name", header: "Initiative" },
    { accessorKey: "sector", header: "Sector" },
    { accessorKey: "resource", header: "资源类型" },
    {
      accessorKey: "amount",
      header: "预算金额",
      cell: (x) => (
        <span className="numeric">{formatMoney(x.row.original.amount)}</span>
      ),
    },
    {
      id: "allocated",
      header: "已分配",
      cell: (x) => (
        <span className="numeric">
          {formatMoney(
            selected?.allocations
              .filter((a) => a.initiativeId === x.row.original.id)
              .reduce((sum, a) => sum + a.amount, 0) ?? 0,
          )}
        </span>
      ),
    },
    {
      accessorKey: "pool",
      header: "待分配池",
      cell: (x) => (
        <span className="numeric">{formatMoney(x.row.original.pool)}</span>
      ),
    },
  ];
  async function exportSnapshot() {
    if (!selected) return;
    try {
      await exportDataset(
        {
          ...state,
          budgets: selected.budgets,
          allocations: selected.allocations,
          forecast: selected.forecast,
        },
        "adjust",
        { department: exportDepartment },
      );
      notify(
        `已导出 ${selected.name} · ${exportDepartment} 的分配快照`,
        "success",
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "导出失败，请重试",
        "error",
      );
    }
  }
  return (
    <div className="page-stack">
      <PageHeader
        title="部门确认与正式提交"
        description="汇总各部门规划结果，将当前方案保存为季度追踪的预算基线。"
      />
      <MetricStrip
        items={[
          {
            label: "预算总额",
            value: formatMoney(summary.budget),
            hint: "含待分配池",
          },
          {
            label: "完成项目",
            value: `${summary.completed} / ${summary.count}`,
            hint: "Initiative 确认进度",
          },
          {
            label: "待分配池",
            value: formatMoney(summary.pool),
            hint: "纳入正式预算，保留分配空间",
            tone: summary.pool > 0 ? "amber" : undefined,
          },
          {
            label: "部门确认",
            value: `${activeDepartments.filter((d) => state.confirmed[d]).length} / ${activeDepartments.length}`,
            hint: "仅有预算的部门需要确认",
          },
        ]}
      />
      <Panel
        title="部门确认状态"
        description="调整预算或相关输入后，需要重新确认受影响的部门。"
      >
        <div className="version-list">
          {DEPARTMENTS.map((d) => {
            const total = totals(state, d);
            const confirmed = !!state.confirmed[d];
            return (
              <div className="row-between" key={d}>
                <div>
                  <strong>{d}</strong>
                  <p className="muted small">
                    {total.count} 个 Initiative · 已完成 {total.completed} 个 ·
                    预算 {formatMoney(total.budget)} · 待分配{" "}
                    {formatMoney(total.pool)}
                  </p>
                </div>
                <div className="actions">
                  <StatusBadge
                    tone={
                      !total.count
                        ? "neutral"
                        : confirmed
                          ? "success"
                          : "warning"
                    }
                  >
                    {!total.count ? "无预算" : confirmed ? "已确认" : "待确认"}
                  </StatusBadge>
                  <Button
                    appearance="subtle"
                    icon={<ArrowRight />}
                    iconPosition="after"
                    onClick={() => {
                      setDepartment(d);
                      navigate("adjust");
                    }}
                  >
                    查看与调整
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
      <Panel
        title="发布预算版本"
        description="版本保存当前预算、分配结果和预计数据。后续调整将形成新版本，已有版本不可覆盖。"
      >
        <div className="page-stack">
          <div className={ready ? "notice" : "notice notice-warning"}>
            {ready
              ? "各预算部门均已确认，可以正式提交。"
              : "请先完成项目拆分，并在部门调整页面确认所有有预算的部门。"}
          </div>
          <Field label="提交说明">
            <Textarea
              value={note}
              onChange={(_, data) => setNote(data.value)}
              rows={3}
              placeholder="例如：2027 年首版预算，保留部分资源供季度滚动分配"
            />
          </Field>
          <div className="row-between">
            <span className="muted small">
              本机演示：版本保存在当前浏览器，不代表企业审批或服务端发布。
            </span>
            <Button
              appearance="primary"
              icon={<SealCheck />}
              disabled={!ready}
              onClick={() => {
                if (
                  run(
                    (s) => publishVersion(s, note.trim()),
                    "已生成正式预算版本",
                  )
                ) {
                  setNote("");
                  setSelectedId("");
                }
              }}
            >
              正式提交并生成版本
            </Button>
          </div>
        </div>
      </Panel>
      <Panel title="已提交版本">
        {!selected ? (
          <EmptyState
            title="尚无正式版本"
            description="完成部门确认后，在上方发布首个预算版本。"
          />
        ) : (
          <div className="page-stack">
            <div className="toolbar">
              <Field label="查看版本">
                <Select
                  value={selected.id}
                  onChange={(_, data) => setSelectedId(data.value)}
                >
                  {state.versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} · {new Date(v.createdAt).toLocaleString("zh-CN")}
                    </option>
                  ))}
                </Select>
              </Field>
              <StatusBadge tone="success">已存档 · 不可覆盖</StatusBadge>
            </div>
            <p className="muted">{selected.note || "此版本未填写提交说明。"}</p>
            <div className="toolbar">
              <Field label="导出部门">
                <Select
                  value={exportDepartment}
                  onChange={(_, data) =>
                    setExportDepartment(data.value as Department)
                  }
                >
                  {DEPARTMENTS.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </Select>
              </Field>
              <Button
                icon={<DownloadSimple />}
                onClick={() => void exportSnapshot()}
              >
                导出部门快照
              </Button>
            </div>
            <DataTable
              columns={columns}
              data={selected.budgets}
              caption={`${selected.name} 预算快照`}
            />
            <div className="actions">
              <Button
                appearance="primary"
                icon={<ArrowRight />}
                iconPosition="after"
                onClick={() => navigate("tracking")}
              >
                进入季度 Tracking
              </Button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
