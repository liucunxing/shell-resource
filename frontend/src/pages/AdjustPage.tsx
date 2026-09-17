import { useState } from "react";
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
  ArrowsLeftRight,
  CheckCircle,
} from "@phosphor-icons/react";
import type { ColumnDef } from "@tanstack/react-table";
import type { Allocation } from "../domain/types";
import {
  confirmDepartment,
  confirmInitiative,
  formatMoney,
  getInsights,
  setAllocationAmount,
  totals,
  transferAllocation,
} from "../domain/engine";
import { useWorkspace } from "../state/WorkspaceContext";
import {
  DataTable,
  DepartmentTabs,
  EmptyState,
  InsightList,
  MetricStrip,
  MoneyInput,
  PageHeader,
  Panel,
  StatusBadge,
} from "../components/ui";
import { ScopedExcelActions } from "./AllocationPage";

export function AdjustPage() {
  const { state, department, run, navigate, notify } = useWorkspace();
  const [filter, setFilter] = useState("all");
  const [transferId, setTransferId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const budgets = state.budgets.filter((b) => b.department === department);
  const budgetMap = new Map(budgets.map((b) => [b.id, b]));
  const allRows = state.allocations.filter((a) =>
    budgetMap.has(a.initiativeId),
  );
  const effectiveFilter = budgetMap.has(filter) ? filter : "all";
  const rows = allRows.filter(
    (a) => effectiveFilter === "all" || a.initiativeId === effectiveFilter,
  );
  const summary = totals(state, department);
  const source = allRows.find((a) => a.id === transferId);
  const targets = source
    ? allRows.filter(
        (a) =>
          a.initiativeId === source.initiativeId &&
          a.id !== source.id &&
          !a.locked,
      )
    : [];
  const confirmed = Boolean(state.confirmed[department]);
  const setExplanation = (row: Allocation, explanation: string) => {
    if (explanation === row.explanation) return;
    run(
      (s) => ({
        ...s,
        allocations: s.allocations.map((a) =>
          a.id === row.id ? { ...a, explanation } : a,
        ),
        confirmed: { ...s.confirmed, [department]: false },
      }),
      "更新预算调整说明",
    );
  };
  const columns: ColumnDef<Allocation, any>[] = [
    {
      accessorKey: "distributor",
      header: "经销商",
      cell: ({ row }) => (
        <div>
          <strong>{row.original.distributor}</strong>
          <div className="muted">
            {budgetMap.get(row.original.initiativeId)?.sector}
          </div>
        </div>
      ),
    },
    {
      id: "initiative",
      header: "项目",
      cell: ({ row }) => (
        <div>
          {budgetMap.get(row.original.initiativeId)?.name}
          <div className="muted">
            {budgetMap.get(row.original.initiativeId)?.resource}
          </div>
        </div>
      ),
    },
    {
      id: "initial",
      header: "初始分配（元）",
      cell: ({ row }) => (
        <span className="numeric">
          {formatMoney(row.original.initialAmount)}
        </span>
      ),
    },
    {
      id: "amount",
      header: "当前金额（元）",
      cell: ({ row }) => (
        <MoneyInput
          value={row.original.amount}
          disabled={row.original.locked}
          label={`${row.original.distributor}当前金额`}
          onCommit={(n) =>
            run(
              (s) => setAllocationAmount(s, row.original.id, n),
              "调整经销商预算",
            )
          }
        />
      ),
    },
    {
      id: "change",
      header: "变化（元 / %）",
      cell: ({ row }) => {
        const difference = row.original.amount - row.original.initialAmount;
        const percent =
          row.original.initialAmount === 0
            ? difference === 0
              ? "无变化"
              : "新增"
            : `${difference > 0 ? "+" : ""}${((difference / row.original.initialAmount) * 100).toFixed(1)}%`;
        return (
          <div className="numeric">
            {difference > 0 ? "+" : ""}
            {formatMoney(difference)}
            <div className="muted">{percent}</div>
          </div>
        );
      },
    },
    {
      id: "lock",
      header: "锁定",
      cell: ({ row }) => (
        <Checkbox
          aria-label={`锁定${row.original.distributor}金额`}
          checked={row.original.locked}
          onChange={(_, d) =>
            run(
              (s) => ({
                ...s,
                allocations: s.allocations.map((a) =>
                  a.id === row.original.id
                    ? { ...a, locked: d.checked === true }
                    : a,
                ),
                budgets: s.budgets.map((b) =>
                  b.id === row.original.initiativeId
                    ? { ...b, completed: false }
                    : b,
                ),
                confirmed: { ...s.confirmed, [department]: false },
              }),
              "更新金额锁定状态",
            )
          }
        />
      ),
    },
    {
      id: "explanation",
      header: "业务说明",
      cell: ({ row }) => (
        <Input
          aria-label={`${row.original.distributor}业务说明`}
          key={`${row.original.id}-${row.original.explanation}`}
          defaultValue={row.original.explanation}
          placeholder="填写调整依据"
          onBlur={(e) => setExplanation(row.original, e.target.value.trim())}
        />
      ),
    },
    {
      id: "transfer",
      header: "操作",
      cell: ({ row }) => (
        <Button
          appearance="subtle"
          icon={<ArrowsLeftRight />}
          disabled={row.original.locked || row.original.amount <= 0}
          onClick={() => {
            setTransferId(row.original.id);
            setTargetId("");
            setTransferAmount("");
          }}
        >
          转移
        </Button>
      ),
    },
  ];
  return (
    <div className="page-stack">
      <PageHeader
        title="部门调整与洞察"
        description="检查部门预算组合，调整经销商金额并记录业务依据。"
        actions={
          <Button
            icon={<ArrowRight />}
            iconPosition="after"
            onClick={() => navigate("submit")}
          >
            查看正式提交
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
            label: "当前已分配",
            value: formatMoney(summary.allocated),
            hint: `${allRows.length} 条经销商分配`,
          },
          {
            label: "待分配池",
            value: formatMoney(summary.pool),
            tone: summary.pool ? "amber" : "green",
          },
          {
            label: "确认状态",
            value: confirmed ? "已确认" : "待确认",
            hint: `${summary.completed} / ${budgets.length} 个项目已确认`,
            tone: confirmed ? "green" : "amber",
          },
        ]}
      />
      {!allRows.length ? (
        <EmptyState
          title="当前部门还没有拆分结果"
          description="先完成单项拆分，再进入部门调整。"
          action={
            <Button appearance="primary" onClick={() => navigate("allocation")}>
              前往单项拆分
            </Button>
          }
        />
      ) : (
        <>
          <Panel
            title="在线调整"
            description="金额减少时回到同项目待分配池；增加时从池中支取。跨经销商调整可使用转移。"
            actions={
              <StatusBadge tone={confirmed ? "success" : "warning"}>
                {confirmed ? "部门已确认" : "调整中"}
              </StatusBadge>
            }
          >
            <ScopedExcelActions key={department} dataset="adjust" />
            <div className="toolbar">
              <Field label="筛选项目">
                <Select
                  value={budgetMap.has(filter) ? filter : "all"}
                  onChange={(_, d) => setFilter(d.value)}
                >
                  <option value="all">全部项目</option>
                  {budgets.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button onClick={() => navigate("allocation")}>
                返回单项拆分
              </Button>
            </div>
            <DataTable
              columns={columns}
              data={rows}
              emptyText="所选项目暂无拆分记录。"
              caption="预算金额单位：人民币元。锁定后不可直接编辑或参与转移。"
            />
            <p className="table-note">
              调整会撤销相关确认。完成后请重新确认项目，再确认本部门结果。
            </p>
          </Panel>
          <div className="workspace-grid">
            <Panel
              title="项目待分配池"
              description="保留未分配金额时，请说明原因。"
            >
              <div className="page-stack">
                {budgets.map((b) => (
                  <div key={b.id}>
                    <div className="row-between">
                      <strong>{b.name}</strong>
                      <span className="numeric">{formatMoney(b.pool)} 元</span>
                    </div>
                    <Field label={`${b.name}待分配说明`}>
                      <Textarea
                        key={`${b.id}-${b.poolReason}`}
                        defaultValue={b.poolReason}
                        placeholder="例如：新客户拓展额度，待季度评审后分配"
                        resize="vertical"
                        onBlur={(e) => {
                          const reason = e.target.value.trim();
                          if (reason !== b.poolReason)
                            run(
                              (s) => ({
                                ...s,
                                budgets: s.budgets.map((item) =>
                                  item.id === b.id
                                    ? {
                                        ...item,
                                        poolReason: reason,
                                        completed: false,
                                      }
                                    : item,
                                ),
                                confirmed: {
                                  ...s.confirmed,
                                  [department]: false,
                                },
                              }),
                              "更新待分配池说明",
                            );
                        }}
                      />
                    </Field>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel
              title="实时洞察"
              description="规则提示用于辅助判断，结合实际业务确认。"
            >
              <InsightList items={getInsights(state, department)} />
            </Panel>
          </div>
          <Panel
            title="确认部门结果"
            description="所有项目确认后，将当前部门结果标记为可提交。"
          >
            <div className="page-stack">
              <div className="actions">
                {budgets.map((b) => (
                  <Button
                    key={b.id}
                    size="small"
                    disabled={b.completed}
                    icon={b.completed ? <CheckCircle /> : undefined}
                    onClick={() =>
                      run(
                        (s) => confirmInitiative(s, b.id),
                        `确认项目：${b.name}`,
                      )
                    }
                  >
                    {b.completed ? "已确认" : "确认"} · {b.name}
                  </Button>
                ))}
              </div>
              <div className="row-between">
                <span className="muted">
                  {summary.completed} / {budgets.length} 个项目已确认
                </span>
                <Button
                  appearance="primary"
                  icon={<CheckCircle />}
                  disabled={confirmed}
                  onClick={() =>
                    run(
                      (s) => confirmDepartment(s, department),
                      "确认部门预算结果",
                    )
                  }
                >
                  {confirmed ? "本部门结果已确认" : "确认本部门结果"}
                </Button>
              </div>
            </div>
          </Panel>
        </>
      )}
      <Dialog
        open={Boolean(source)}
        onOpenChange={(_, d) => {
          if (!d.open) setTransferId("");
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>项目内预算转移</DialogTitle>
            <DialogContent>
              <div className="page-stack">
                <p className="muted">
                  从 {source?.distributor}{" "}
                  转出至同项目的另一家经销商；项目总金额保持不变。
                </p>
                <Field label="接收经销商">
                  <Select
                    value={targetId}
                    onChange={(_, d) => setTargetId(d.value)}
                  >
                    <option value="">请选择接收经销商</option>
                    {targets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.distributor}
                      </option>
                    ))}
                  </Select>
                </Field>
                {!targets.length && (
                  <p className="notice notice-warning">
                    没有可用接收对象，请先添加分配记录或解除锁定。
                  </p>
                )}
                <Field
                  label={`转移金额（最多 ${formatMoney(source?.amount ?? 0)} 元）`}
                >
                  <Input
                    type="number"
                    min={1}
                    max={source?.amount ?? 0}
                    value={transferAmount}
                    onChange={(_, d) => setTransferAmount(d.value)}
                  />
                </Field>
              </div>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setTransferId("")}>取消</Button>
              <Button
                appearance="primary"
                disabled={!targetId}
                onClick={() => {
                  const amount = Number(transferAmount);
                  if (
                    !source ||
                    !targetId ||
                    !Number.isFinite(amount) ||
                    amount <= 0
                  )
                    return notify("请选择接收对象并输入大于零的金额", "error");
                  if (
                    run(
                      (s) => transferAllocation(s, source.id, targetId, amount),
                      "完成项目内预算转移",
                    )
                  )
                    setTransferId("");
                }}
              >
                确认转移
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
