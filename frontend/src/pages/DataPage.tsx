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
  Input,
  Select,
  Tab,
  TabList,
} from "@fluentui/react-components";
import {
  DownloadSimple,
  UploadSimple,
  Plus,
  PencilSimple,
  Trash,
} from "@phosphor-icons/react";
import { type ColumnDef } from "@tanstack/react-table";
import { useWorkspace } from "../state/WorkspaceContext";
import {
  PageHeader,
  Panel,
  MetricStrip,
  DataTable,
  StatusBadge,
} from "../components/ui";
import {
  applyDataset,
  datasetRows,
  exportDataset,
  invalidate,
  parseDataset,
  specs,
  validateRows,
  type Dataset,
} from "../domain/excel";
import { DEPARTMENTS, RESOURCES, SECTORS } from "../domain/types";
import { formatMoney } from "../domain/engine";
type Row = Record<string, unknown>;
export function DataPage() {
  const { state, run, notify, navigate } = useWorkspace();
  const [tab, setTab] = useState<Dataset | "summary">("budgets");
  const [search, setSearch] = useState("");
  const [sector, setSector] = useState("all");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{
    type: Dataset;
    rows: Row[];
    errors: string[];
    count: number;
  } | null>(null);
  const [edit, setEdit] = useState<{
    type: "budgets" | "forecast";
    index: number;
    row: Row;
  } | null>(null);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [remove, setRemove] = useState<{
    type: "budgets" | "forecast";
    index: number;
  } | null>(null);
  const type = tab === "summary" ? "budgets" : tab;
  const rows = datasetRows(state, type);
  const filtered = rows.filter(
    (r) =>
      (sector === "all" || r.Sector === sector) &&
      Object.values(r).some((v) =>
        String(v ?? "")
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
  );
  const download = async (template = false) => {
    setBusy(true);
    try {
      await exportDataset(state, type, { template });
      notify(template ? "模板已下载" : "已导出当前数据", "success");
    } catch (e) {
      notify(String(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const columns: ColumnDef<Row, unknown>[] = specs[type].headers.map((h) => ({
    accessorKey: h,
    header: h,
    cell: ({ getValue }) => {
      const v = getValue();
      return typeof v === "number" && h !== "Year" ? (
        <span className="numeric">{formatMoney(v)}</span>
      ) : (
        String(v ?? "未提供")
      );
    },
  }));
  if (type === "budgets" || type === "forecast")
    columns.push({
      id: "actions",
      header: "操作",
      cell: ({ row }) => (
        <div className="actions">
          <Button
            appearance="subtle"
            icon={<PencilSimple />}
            aria-label={`编辑 ${String(row.original.Initiative ?? row.original.Distributor)}`}
            onClick={() => {
              setFormErrors([]);
              setEdit({
                type,
                index: rows.indexOf(row.original),
                row: { ...row.original },
              });
            }}
          />
          <Button
            appearance="subtle"
            icon={<Trash />}
            aria-label={`删除 ${String(row.original.Initiative ?? row.original.Distributor)}`}
            onClick={() =>
              setRemove({ type, index: rows.indexOf(row.original) })
            }
          />
        </div>
      ),
    });
  const save = () => {
    if (!edit) return;
    const all = datasetRows(state, edit.type);
    if (edit.index < 0) all.push(edit.row);
    else all[edit.index] = edit.row;
    const errors = validateRows(all, edit.type, state);
    setFormErrors(errors);
    if (errors.length) return;
    if (
      run(
        (s) => {
          const next = applyDataset(s, edit.type, all);
          if (edit.type === "forecast") return next;
          const old = s.budgets[edit.index];
          const candidate =
            next.budgets[edit.index < 0 ? next.budgets.length - 1 : edit.index];
          const cleared = invalidate(s, old ? [old.id] : []);
          const saved = { ...candidate, id: old?.id ?? candidate.id };
          return {
            ...cleared,
            dataMode: "user",
            budgets: old
              ? cleared.budgets.map((b) => (b.id === old.id ? saved : b))
              : [...cleared.budgets, saved],
            confirmed: { ...cleared.confirmed, [saved.department]: false },
          };
        },
        `保存${edit.type === "budgets" ? "预算项目" : "预计数据"}`,
      )
    )
      setEdit(null);
  };
  const doRemove = () => {
    if (!remove) return;
    const r = remove;
    if (
      run((s) => {
        if (r.type === "forecast") {
          const next = invalidate(
            s,
            s.budgets.map((b) => b.id),
          );
          return {
            ...next,
            dataMode: "user",
            forecast: s.forecast.filter((_, i) => i !== r.index),
          };
        }
        const b = s.budgets[r.index];
        const next = invalidate(s, [b.id]);
        return {
          ...next,
          dataMode: "user",
          budgets: next.budgets.filter((x) => x.id !== b.id),
          applicable: s.applicable.filter((a) => a.initiativeId !== b.id),
        };
      }, "删除数据记录")
    )
      setRemove(null);
  };
  const issues = [
    !state.budgets.length ? "尚未维护预算内容" : null,
    !state.history.length ? "尚未导入历史表现" : null,
  ].filter(Boolean);
  return (
    <div className="page-stack">
      <PageHeader
        title="数据准备"
        description="维护预算总盘与历史表现，为每项投资建立清晰的分配依据。"
      />
      <TabList
        selectedValue={tab}
        onTabSelect={(_, d) => {
          setTab(d.value as typeof tab);
          setSearch("");
          setSector("all");
        }}
      >
        <Tab value="budgets">预算内容</Tab>
        <Tab value="history">历史表现</Tab>
        <Tab value="forecast">明年预计</Tab>
        <Tab value="summary">数据总结</Tab>
      </TabList>
      {state.dataMode === "user" && (
        <div className="notice notice-warning">
          已录入用户数据。单表导入可能与其余示例数据混用，当前结果不可作为真实业务分析；请逐表核对完整数据。
        </div>
      )}
      {tab === "summary" ? (
        <>
          <MetricStrip
            items={[
              { label: "预算条目", value: state.budgets.length, hint: "必需" },
              { label: "历史记录", value: state.history.length, hint: "必需" },
              { label: "预计数据", value: state.forecast.length, hint: "可选" },
              {
                label: "准备状态",
                value: issues.length ? "待完善" : "已准备",
                hint:
                  state.dataMode === "demo"
                    ? "当前为示例数据"
                    : "请核对数据来源",
              },
            ]}
          />
          <Panel
            title="数据检查"
            actions={
              <Button
                appearance="primary"
                disabled={!!issues.length}
                onClick={() => navigate("allocation")}
              >
                进入初始预算拆分
              </Button>
            }
          >
            <div className={issues.length ? "notice notice-warning" : "notice"}>
              {issues.length
                ? issues.join("；")
                : "预算与历史数据已就绪，可以开始逐项目拆分。"}
            </div>
            <p className="muted">
              历史粒度为 Year + Quarter + Sector + Distributor + Resource
              Type。预计数据用于投资观察，不作为默认拆分依据。
            </p>
            <p className="muted">
              更新上游数据后，受影响的分配、完成标记与部门确认将撤销；已发布版本继续保留。
            </p>
          </Panel>
        </>
      ) : (
        <>
          <MetricStrip
            items={
              tab === "budgets"
                ? [
                    {
                      label: "预算总盘",
                      value: formatMoney(
                        state.budgets.reduce((n, b) => n + b.amount, 0),
                      ),
                      hint: "元",
                    },
                    { label: "Initiative", value: state.budgets.length },
                    {
                      label: "覆盖部门",
                      value: new Set(state.budgets.map((b) => b.department))
                        .size,
                    },
                  ]
                : tab === "history"
                  ? [
                      { label: "历史记录", value: state.history.length },
                      {
                        label: "Distributor",
                        value: new Set(state.history.map((r) => r.distributor))
                          .size,
                      },
                      {
                        label: "覆盖年度",
                        value:
                          [...new Set(state.history.map((r) => r.year))]
                            .sort()
                            .join(" / ") || "未提供",
                      },
                    ]
                  : [
                      { label: "预计数据", value: state.forecast.length },
                      {
                        label: "Distributor",
                        value: new Set(state.forecast.map((r) => r.distributor))
                          .size,
                      },
                      {
                        label: "使用方式",
                        value: "辅助观察",
                        hint: "不作为默认分配依据",
                      },
                    ]
            }
          />
          <Panel
            title={specs[type].sheet}
            description={
              tab === "budgets"
                ? "按 Sector、部门、资源类型与 Initiative 维护年度计划金额。"
                : tab === "history"
                  ? "保留客户原始数据粒度，季度与全年数据分别识别。"
                  : "Year + Sector + Distributor；预计 Vol / C3 为可选输入。"
            }
            actions={
              <div className="actions">
                <Button disabled={busy} onClick={() => void download(true)}>
                  下载模板
                </Button>
                <Button
                  icon={<DownloadSimple />}
                  disabled={busy}
                  onClick={() => void download()}
                >
                  导出
                </Button>
                <Button
                  icon={<UploadSimple />}
                  disabled={busy}
                  onClick={() => input.current?.click()}
                >
                  {busy ? "处理中…" : "导入 Excel"}
                </Button>
                {(tab === "budgets" || tab === "forecast") && (
                  <Button
                    appearance="primary"
                    icon={<Plus />}
                    onClick={() => {
                      setFormErrors([]);
                      setEdit({
                        type: tab,
                        index: -1,
                        row:
                          tab === "budgets"
                            ? {
                                Sector: "PCMO",
                                Department: "MKT",
                                "Resource Type": "SP&A BTL",
                                Initiative: "",
                                PlanBudget: "",
                              }
                            : {
                                Year: 2027,
                                Sector: "PCMO",
                                Distributor: "",
                                ExpectedVol: "",
                                ExpectedC3: "",
                              },
                      });
                    }}
                  >
                    添加{tab === "budgets" ? "预算" : "预计"}
                  </Button>
                )}
              </div>
            }
          >
            <input
              ref={input}
              hidden
              type="file"
              accept=".xlsx,.xls"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setBusy(true);
                const result = await parseDataset(file, type, state);
                setPreview({ type, ...result });
                setBusy(false);
              }}
            />
            <div className="toolbar">
              <Input
                aria-label="搜索数据"
                placeholder="搜索项目、经销商或资源类型"
                value={search}
                onChange={(_, d) => setSearch(d.value)}
              />
              <Select
                aria-label="筛选 Sector"
                value={sector}
                onChange={(e) => setSector(e.target.value)}
              >
                <option value="all">所有 Sector</option>
                {SECTORS.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </Select>
              <span className="muted small">共 {filtered.length} 条</span>
            </div>
            <DataTable
              columns={columns}
              data={filtered}
              emptyText={
                rows.length
                  ? "没有符合筛选条件的记录"
                  : "尚无数据，请下载模板或添加记录"
              }
            />
            <p className="table-note">
              Excel 仅支持
              .xlsx。导入先校验预览，全部通过后替换当前整张表；金额单位：元。
            </p>
          </Panel>
        </>
      )}
      <Dialog
        open={!!preview}
        onOpenChange={(_, d) => {
          if (!d.open) setPreview(null);
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>
              导入预览 · {preview && specs[preview.type].sheet}
            </DialogTitle>
            <DialogContent>
              <p>
                读取 {preview?.count ?? 0} 条数据。确认后替换该表的全部记录。
              </p>
              {preview?.errors.length ? (
                <div role="alert" className="notice notice-danger">
                  {preview.errors.map((e, i) => (
                    <p key={i}>{e}</p>
                  ))}
                </div>
              ) : (
                <>
                  <StatusBadge tone="success">校验通过</StatusBadge>
                  <p className="muted">
                    上游更新将撤销分配与确认。正式版本保留。
                  </p>
                  <div style={{ overflowX: "auto" }}>
                    <table>
                      <thead>
                        <tr>
                          {preview &&
                            specs[preview.type].headers.map((h) => (
                              <th key={h}>{h}</th>
                            ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview?.rows.slice(0, 5).map((r, i) => (
                          <tr key={i}>
                            {specs[preview.type].headers.map((h) => (
                              <td key={h}>{String(r[h] ?? "")}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="small muted">
                    仅预览前 5 条；校验覆盖全部记录。
                  </p>
                </>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setPreview(null)}>取消</Button>
              <Button
                appearance="primary"
                disabled={!preview || !!preview.errors.length}
                onClick={() => {
                  if (
                    preview &&
                    run(
                      (s) => applyDataset(s, preview.type, preview.rows),
                      `导入${specs[preview.type].sheet} ${preview.count} 条`,
                    )
                  )
                    setPreview(null);
                }}
              >
                确认替换
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      <Dialog
        open={!!edit}
        onOpenChange={(_, d) => {
          if (!d.open) setEdit(null);
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>
              {edit?.index === -1 ? "添加" : "编辑"}
              {edit?.type === "budgets" ? "预算项目" : "预计数据"}
            </DialogTitle>
            <DialogContent>
              <div className="field-grid">
                {edit &&
                  specs[edit.type].headers.map((h) => {
                    const opts =
                      h === "Sector"
                        ? SECTORS
                        : h === "Department"
                          ? DEPARTMENTS
                          : h === "Resource Type"
                            ? RESOURCES
                            : null;
                    const update = (value: string) =>
                      setEdit({ ...edit, row: { ...edit.row, [h]: value } });
                    return (
                      <Field key={h} label={h} required>
                        {opts ? (
                          <Select
                            value={String(edit.row[h] ?? "")}
                            onChange={(e) => update(e.target.value)}
                          >
                            {opts.map((x) => (
                              <option key={x}>{x}</option>
                            ))}
                          </Select>
                        ) : (
                          <Input
                            type={
                              [
                                "PlanBudget",
                                "Year",
                                "ExpectedVol",
                                "ExpectedC3",
                              ].includes(h)
                                ? "number"
                                : "text"
                            }
                            min={0}
                            value={String(edit.row[h] ?? "")}
                            onChange={(_, d) => update(d.value)}
                          />
                        )}
                      </Field>
                    );
                  })}
              </div>
              {formErrors.length > 0 && (
                <div role="alert" className="notice notice-danger">
                  {formErrors.join("；")}
                </div>
              )}
              <p className="muted small">
                保存后将清除受影响的分配结果与确认标记。
              </p>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setEdit(null)}>取消</Button>
              <Button appearance="primary" onClick={save}>
                保存
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      <Dialog
        open={!!remove}
        onOpenChange={(_, d) => {
          if (!d.open) setRemove(null);
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>删除这条记录？</DialogTitle>
            <DialogContent>
              此操作会清除受影响的分配与确认；已经发布的正式版本保留。
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setRemove(null)}>取消</Button>
              <Button appearance="primary" onClick={doRemove}>
                确认删除
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
