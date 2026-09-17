import { useRef, useState } from "react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Select,
  Textarea,
} from "@fluentui/react-components";
import {
  ArrowRight,
  Check,
  Plus,
  Trash,
  Calculator,
} from "@phosphor-icons/react";
import type { ColumnDef } from "@tanstack/react-table";
import type {
  Allocation,
  ApplicableRow,
  Budget,
  WorkspaceState,
} from "../domain/types";
import {
  confirmInitiative,
  formatMoney,
  generateAllocation,
  makeId,
  totals,
} from "../domain/engine";
import { useWorkspace } from "../state/WorkspaceContext";
import {
  DataTable,
  DepartmentTabs,
  EmptyState,
  MetricStrip,
  PageHeader,
  Panel,
  StatusBadge,
} from "../components/ui";
import { applyDataset, exportDataset, parseDataset } from "../domain/excel";

export function ScopedExcelActions({
  dataset,
  initiativeId,
}: {
  dataset: "applicable" | "adjust";
  initiativeId?: string;
}) {
  const { state, department, run, notify } = useWorkspace();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<
    | (Awaited<ReturnType<typeof parseDataset>> & {
        name: string;
        department: typeof department;
        initiativeId?: string;
      })
    | null
  >(null);
  const label = dataset === "applicable" ? "适用范围" : "部门调整";
  const handleFile = async (file: File) => {
    setBusy(true);
    const result = await parseDataset(file, dataset, state, {
      department,
      initiativeId,
    });
    setPreview({ ...result, name: file.name, department, initiativeId });
    setBusy(false);
  };
  return (
    <>
      <div className="actions">
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await exportDataset(state, dataset, { department, initiativeId });
              notify(`${label}已导出`, "success");
            } catch {
              notify("导出失败，请重试", "error");
            } finally {
              setBusy(false);
            }
          }}
        >
          导出{label}
        </Button>
        <Button disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "正在处理…" : `导入${label}`}
        </Button>
        <input
          ref={input}
          type="file"
          accept=".xlsx"
          hidden
          aria-label={`导入${label}Excel`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void handleFile(file);
          }}
        />
      </div>
      <Dialog
        open={Boolean(preview)}
        onOpenChange={(_, d) => {
          if (!d.open) setPreview(null);
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{label}导入预校验</DialogTitle>
            <DialogContent>
              <div className="page-stack">
                <p>{preview?.name}</p>
                <p>
                  识别 {preview?.count ?? 0} 条记录，发现{" "}
                  {preview?.errors.length ?? 0} 个问题。
                </p>
                {preview?.errors.length ? (
                  <div className="notice notice-danger">
                    <ul>
                      {preview.errors.slice(0, 20).map((error, i) => (
                        <li key={i}>{error}</li>
                      ))}
                    </ul>
                    {preview.errors.length > 20 && (
                      <p>
                        另有 {preview.errors.length - 20}{" "}
                        个问题，请修正文件后重新导入。
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    <p className="notice notice-warning">
                      确认后将替换
                      {dataset === "applicable"
                        ? "当前项目适用范围，清空本项目拆分结果"
                        : "当前部门调整结果"}
                      并撤销相关确认。
                    </p>
                    <DataTable
                      columns={[
                        { accessorKey: "Distributor", header: "经销商" },
                        { accessorKey: "Initiative", header: "项目" },
                        {
                          accessorKey:
                            dataset === "applicable" ? "Source" : "PlanAmount",
                          header:
                            dataset === "applicable" ? "来源" : "调整金额",
                        },
                      ]}
                      data={preview?.rows.slice(0, 10) ?? []}
                      caption="导入预览：前 10 条"
                    />
                  </>
                )}
              </div>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setPreview(null)}>取消</Button>
              <Button
                appearance="primary"
                disabled={!preview || preview.errors.length > 0}
                onClick={() => {
                  if (!preview) return;
                  if (
                    preview.department !== department ||
                    preview.initiativeId !== initiativeId
                  ) {
                    setPreview(null);
                    notify("工作区已变更，请在当前工作区重新导入", "error");
                    return;
                  }
                  if (
                    run(
                      (s) =>
                        applyDataset(s, dataset, preview.rows, {
                          department,
                          initiativeId,
                        }),
                      `导入${label} ${preview.count} 条记录`,
                    )
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
    </>
  );
}

function resetInitiative(s: WorkspaceState, budget: Budget): WorkspaceState {
  return {
    ...s,
    budgets: s.budgets.map((b) =>
      b.id === budget.id
        ? { ...budget, completed: false, pool: budget.amount }
        : b,
    ),
    allocations: s.allocations.filter((a) => a.initiativeId !== budget.id),
    confirmed: { ...s.confirmed, [budget.department]: false },
  };
}

export function AllocationPage() {
  const { state, department, run, navigate, notify } = useWorkspace();
  const [selected, setSelected] = useState("");
  const [newDistributor, setNewDistributor] = useState("");
  const [historyCandidate, setHistoryCandidate] = useState("");
  const budgets = state.budgets.filter((b) => b.department === department);
  const budget =
    budgets.find((b) => b.id === selected) ??
    budgets.find((b) => !b.completed) ??
    budgets[0];
  const summary = totals(state, department);
  if (!budget)
    return (
      <div className="page-stack">
        <PageHeader
          title="初始预算拆分"
          description="逐个项目确定适用范围与拆分依据。"
        />
        <DepartmentTabs />
        <EmptyState
          title="当前部门还没有预算项目"
          description="请先在数据库维护本部门预算，再开始拆分。"
          action={
            <Button appearance="primary" onClick={() => navigate("database")}>
              维护预算
            </Button>
          }
        />
      </div>
    );
  const apps = state.applicable.filter((a) => a.initiativeId === budget.id);
  const allocations = state.allocations.filter(
    (a) => a.initiativeId === budget.id,
  );
  const periods = [
    ...new Set([
      budget.period,
      ...state.history.map((h) => `${h.year}-${h.quarter}`),
    ]),
  ]
    .sort()
    .reverse();
  const history = state.history.filter(
    (h) =>
      h.sector === budget.sector &&
      h.resource === budget.resource &&
      `${h.year}-${h.quarter}` === budget.period,
  );
  const historyCandidates = [
    ...new Set(
      state.history
        .filter(
          (h) =>
            h.sector === budget.sector &&
            h.resource === budget.resource &&
            !apps.some((a) => a.distributor === h.distributor),
        )
        .map((h) => h.distributor),
    ),
  ];
  const candidate = historyCandidates.includes(historyCandidate)
    ? historyCandidate
    : (historyCandidates[0] ?? "");
  const configure = (patch: Partial<Budget>) =>
    run(
      (s) =>
        resetInitiative(s, {
          ...s.budgets.find((b) => b.id === budget.id)!,
          ...patch,
        }),
      "更新拆分条件，撤销原分配与确认",
    );
  const changeApps = (
    transform: (rows: ApplicableRow[]) => ApplicableRow[],
    label: string,
  ) =>
    run(
      (s) =>
        resetInitiative(
          { ...s, applicable: transform(s.applicable) },
          s.budgets.find((b) => b.id === budget.id)!,
        ),
      label,
    );
  const appColumns: ColumnDef<ApplicableRow, any>[] = [
    { accessorKey: "distributor", header: "经销商" },
    { accessorKey: "source", header: "来源" },
    {
      id: "enabled",
      header: "参与拆分",
      cell: ({ row }) => (
        <Checkbox
          aria-label={`${row.original.distributor}参与拆分`}
          checked={row.original.enabled}
          onChange={(_, d) =>
            changeApps(
              (rows) =>
                rows.map((a) =>
                  a.id === row.original.id
                    ? { ...a, enabled: d.checked === true }
                    : a,
                ),
              "更新适用范围",
            )
          }
        />
      ),
    },
    {
      id: "actions",
      header: "操作",
      cell: ({ row }) => (
        <Button
          appearance="subtle"
          icon={<Trash />}
          aria-label={`移除${row.original.distributor}`}
          onClick={() =>
            changeApps(
              (rows) => rows.filter((a) => a.id !== row.original.id),
              "移除适用经销商",
            )
          }
        >
          移除
        </Button>
      ),
    },
  ];
  const allocationColumns: ColumnDef<Allocation, any>[] = [
    { accessorKey: "distributor", header: "经销商" },
    { accessorKey: "basisLabel", header: "拆分依据" },
    {
      id: "amount",
      header: "建议预算（元）",
      cell: ({ row }) => (
        <span className="numeric">{formatMoney(row.original.amount)}</span>
      ),
    },
    {
      id: "lock",
      header: "状态",
      cell: ({ row }) => (
        <StatusBadge tone={row.original.locked ? "warning" : "neutral"}>
          {row.original.locked ? "已锁定" : "可调整"}
        </StatusBadge>
      ),
    },
  ];
  const addDistributor = () => {
    const name = newDistributor.trim();
    if (!name) return notify("请输入经销商名称", "error");
    if (apps.some((a) => a.distributor === name))
      return notify("该经销商已在适用范围中", "error");
    if (
      changeApps(
        (rows) => [
          ...rows,
          {
            id: makeId(),
            initiativeId: budget.id,
            distributor: name,
            source: "在线维护",
            enabled: true,
          },
        ],
        "添加适用经销商",
      )
    )
      setNewDistributor("");
  };
  return (
    <div className="page-stack">
      <PageHeader
        title="初始预算拆分"
        description="先确定适用范围，再依据历史表现生成预算建议。"
        actions={
          <Button
            icon={<ArrowRight />}
            iconPosition="after"
            onClick={() => navigate("adjust")}
          >
            进入部门调整
          </Button>
        }
      />
      <DepartmentTabs />
      <MetricStrip
        items={[
          {
            label: "部门预算",
            value: formatMoney(summary.budget),
            hint: "人民币 · 元",
          },
          {
            label: "已确认项目",
            value: `${summary.completed} / ${budgets.length}`,
            hint: "逐项完成拆分",
          },
          { label: "当前已分配", value: formatMoney(summary.allocated) },
          {
            label: "待分配池",
            value: formatMoney(summary.pool),
            tone: summary.pool ? "amber" : "green",
          },
        ]}
      />
      <div className="allocation-layout">
        <aside className="allocation-sidebar">
          <Panel
            title={`${department} 项目`}
            description="选择一个项目开始拆分"
          >
            <div className="initiative-list">
              {budgets.map((b) => (
                <button
                  type="button"
                  key={b.id}
                  className={`initiative-button ${b.id === budget.id ? "active" : ""}`}
                  onClick={() => {
                    setSelected(b.id);
                    setNewDistributor("");
                  }}
                  aria-pressed={b.id === budget.id}
                >
                  <span className="row-between">
                    <strong>{b.name}</strong>
                    {b.completed && <Check size={16} />}
                  </span>
                  <span className="muted">
                    {b.sector} · {b.resource}
                  </span>
                  <span className="numeric">{formatMoney(b.amount)}</span>
                  <StatusBadge tone={b.completed ? "success" : "neutral"}>
                    {b.completed ? "已确认" : "待确认"}
                  </StatusBadge>
                </button>
              ))}
            </div>
          </Panel>
        </aside>
        <div className="allocation-main page-stack">
          <Panel
            title={budget.name}
            description={`${budget.sector} · ${budget.resource}`}
            actions={
              <StatusBadge tone={budget.completed ? "success" : "warning"}>
                {budget.completed ? "单项已确认" : "待单项确认"}
              </StatusBadge>
            }
          >
            <div className="row-between">
              <span className="section-label">项目预算</span>
              <strong className="numeric">
                {formatMoney(budget.amount)} 元
              </strong>
            </div>
            <p className="table-note">
              修改适用范围或拆分条件后，本项目分配与确认会重置；正式版本保留。
            </p>
          </Panel>
          <Panel
            title="01 · 适用经销商"
            description={`已启用 ${apps.filter((a) => a.enabled).length} / ${apps.length} 家经销商`}
          >
            <ScopedExcelActions
              key={`${department}-${budget.id}`}
              dataset="applicable"
              initiativeId={budget.id}
            />
            <div className="toolbar">
              <Field label="从同 Sector / Resource 历史名单添加">
                <Select
                  value={candidate}
                  disabled={!historyCandidates.length}
                  onChange={(_, d) => setHistoryCandidate(d.value)}
                >
                  {historyCandidates.length ? (
                    historyCandidates.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))
                  ) : (
                    <option value="">暂无可添加历史经销商</option>
                  )}
                </Select>
              </Field>
              <Button
                icon={<Plus />}
                disabled={!candidate}
                onClick={() => {
                  if (candidate)
                    changeApps(
                      (rows) => [
                        ...rows,
                        {
                          id: makeId(),
                          initiativeId: budget.id,
                          distributor: candidate,
                          source: "历史表现名单",
                          enabled: true,
                        },
                      ],
                      "从历史名单添加适用经销商",
                    );
                }}
              >
                添加历史经销商
              </Button>
            </div>
            <div className="toolbar">
              <Input
                aria-label="新增经销商名称"
                placeholder="输入经销商名称"
                value={newDistributor}
                onChange={(_, d) => setNewDistributor(d.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addDistributor();
                }}
              />
              <Button icon={<Plus />} onClick={addDistributor}>
                添加经销商
              </Button>
            </div>
            <DataTable
              columns={appColumns}
              data={apps}
              emptyText="尚无适用经销商，请先添加。"
            />
          </Panel>
          <Panel
            title="02 · 拆分条件"
            description="选定历史期间和依据，待分配部分保留在项目资金池中。"
          >
            <div className="field-grid">
              <Field label="历史期间">
                <Select
                  value={budget.period}
                  onChange={(_, d) => configure({ period: d.value })}
                >
                  {periods.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </Select>
              </Field>
              <Field label="权重依据">
                <Select
                  value={budget.basis}
                  onChange={(_, d) =>
                    configure({ basis: d.value as Budget["basis"] })
                  }
                >
                  <option value="Vol">Vol · 销量</option>
                  <option value="C3">C3 · 贡献</option>
                </Select>
              </Field>
              <Field label="待分配比例（%）">
                <Input
                  key={`${budget.id}-${budget.reservePercent}`}
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={String(budget.reservePercent)}
                  onBlur={(e) => {
                    const n = Number(e.target.value);
                    if (!Number.isFinite(n) || n < 0 || n > 100) {
                      e.target.value = String(budget.reservePercent);
                      notify("待分配比例须在 0–100 之间", "error");
                    } else if (n !== budget.reservePercent)
                      configure({ reservePercent: n });
                  }}
                />
              </Field>
            </div>
            <p className="table-note">
              来源：历史表现 · {budget.period} · {budget.sector} ·{" "}
              {budget.resource}，共 {history.length}{" "}
              条记录。全员有效权重为零时均分；部分缺历史时，请补齐数据或暂不启用该经销商。
            </p>
            <Field
              label="待分配池原因"
              hint="保留待分配金额时必须填写原因，修改说明不会改变当前分配金额。"
            >
              <Textarea
                key={`${budget.id}-${budget.poolReason}`}
                defaultValue={budget.poolReason}
                placeholder="例如：预留新客户额度，待明确名单后分配"
                resize="vertical"
                onBlur={(e) => {
                  const reason = e.target.value.trim();
                  if (reason !== budget.poolReason)
                    run(
                      (s) => ({
                        ...s,
                        budgets: s.budgets.map((b) =>
                          b.id === budget.id
                            ? { ...b, poolReason: reason, completed: false }
                            : b,
                        ),
                        confirmed: { ...s.confirmed, [department]: false },
                      }),
                      "更新待分配池原因",
                    );
                }}
              />
            </Field>
            <div className="actions">
              <Button
                appearance="primary"
                icon={<Calculator />}
                onClick={() =>
                  run(
                    (s) => generateAllocation(s, budget.id),
                    "生成项目拆分建议",
                  )
                }
              >
                生成并预览
              </Button>
              <Button
                disabled={!allocations.length || budget.completed}
                icon={<Check />}
                onClick={() =>
                  run((s) => confirmInitiative(s, budget.id), "确认单项拆分")
                }
              >
                {budget.completed ? "已确认该项目" : "确认该项目"}
              </Button>
            </div>
          </Panel>
          <Panel
            title="03 · 分配预览"
            description={`待分配池 ${formatMoney(budget.pool)} 元；金额调整与锁定可在部门调整中完成。`}
          >
            <DataTable
              columns={allocationColumns}
              data={allocations}
              emptyText="选择拆分条件后，点击「生成并预览」。"
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}
