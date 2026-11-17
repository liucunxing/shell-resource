import { MoneyInput } from "./MoneyInput";
import { AlertDescription } from "@/components/ui/alert";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Alert } from "../../components/ui/alert";
import { Card } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
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
import { Checkbox } from "../../components/ui/checkbox";
import { Textarea } from "../../components/ui/textarea";
import { useRef, useState } from "react";
import { AdminImportPanel } from "./AdminImportPanel.jsx";
import { useWorkbench } from "../WorkbenchContext.jsx";
import E from "../domain/engine.js";
import { PageHead } from "./OverviewPages.jsx";
import { PlanningVersionBar as VersionBar } from "./PlanningVersionBar.jsx";
import { PlanningVersionsPage } from "./PlanningVersionsPage.jsx";
import { StudioConfiguration } from "./StudioConfiguration.jsx";
import { AdminUsersPanel } from "./AdminUsersPanel.jsx";
import { HistoricalResourceSettings } from "./HistoricalResourceSettings.jsx";
import { WorkflowDialog } from "./WorkflowDialog.jsx";

const num = (value, digits = 1) =>
  Number(value || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
const time = (value) => (value ? new Date(value).toLocaleString("zh-CN") : "—");
const ADMIN_META = {
  "admin-versions": [
    "VERSIONS",
    "版本与发布",
    "创建、发布和停用规划版本；同时仅一个版本开放提交",
  ],
  "admin-initiatives": [
    "CATALOG",
    "本版项目配置",
    "每个版本独立维护 Initiative 清单、预算、资源大类与 Owner",
  ],
  "admin-users": [
    "USERS & ACCESS",
    "用户与权限",
    "维护登录账号、角色和 Sector / Department 数据范围",
  ],
  "admin-enums": [
    "ORGANIZATION",
    "组织与枚举",
    "维护 Sector、Department、资源大类和历史数据期间",
  ],
  "admin-thresholds": [
    "HEALTH RULES",
    "健康检查阈值",
    "配置集中度和经销商超配 / 低配的提醒阈值",
  ],
  "admin-audit": [
    "AUDIT",
    "操作审计",
    "查看版本、配置、草稿和提交的关键操作记录",
  ],
};

export function initiativePayload(row) {
  const budget = Number(row.budget);
  const issues = [
    ["name", !row.name?.trim(), "请填写 Initiative 名称"],
    ["ownerId", !row.ownerId?.trim(), "请选择 Owner"],
    [
      "budget",
      row.budget === "" ||
        row.budget == null ||
        !Number.isSafeInteger(budget) ||
        budget < 0,
      "预算须为非负整数元",
    ],
    ["reason", !row.reason?.trim(), "请填写变化原因（每个修改项目必填）"],
  ];
  const issue = issues.find(([, invalid]) => invalid);
  if (issue) {
    const error = new Error(
      `${row.name?.trim() || row.initiativeKey || row.id || "新增 Initiative"}：${issue[2]}。`,
    );
    error.field = issue[0];
    throw error;
  }
  return {
    id: row.id,
    name: row.name.trim(),
    sector: row.sector,
    department: row.department,
    resourceType: row.resourceType,
    ownerId: row.ownerId.trim(),
    budget,
    enabled: row.enabled !== false,
    reason: row.reason.trim(),
  };
}

function InitiativesPage({
  items,
  identity,
  roles,
  apiMode,
  mutate,
  manageAdminBudget,
  notify,
  state,
  previewMode,
}) {
  const fieldRefs = useRef(new Map());
  const [invalidField, setInvalidField] = useState(null);
  const [query, setQuery] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const rows = [
    ...items.map((item) => ({
      ...item,
      reason: "",
      ...drafts[item.id],
      _key: String(item.id),
    })),
    ...Object.entries(drafts)
      .filter(([key]) => key.startsWith("new:"))
      .map(([key, value]) => ({ ...value, _key: key })),
  ];
  const filtered = rows.filter((row) =>
    `${row.id || ""} ${row.name} ${row.ownerId}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const edit = (row, key, value) =>
    setDrafts((old) => ({ ...old, [row._key]: { ...row, [key]: value } }));
  const owners = roles
    .filter((user) => user.role === "owner")
    .map((user) => ({
      value: user.email || user.ownerId || user.key,
      label: user.display_name || user.label || user.email || user.ownerId,
    }));
  const add = () => {
    const key = `new:${crypto.randomUUID()}`;
    setDrafts((old) => ({
      ...old,
      [key]: {
        name: "",
        sector: "PCMO",
        department: "MKT",
        resourceType: "MRD",
        ownerId: "",
        budget: 0,
        enabled: true,
        reason: "",
      },
    }));
  };
  const save = async () => {
    let pending;
    try {
      pending = Object.entries(drafts).map(([key, row]) => {
        try {
          return { key, row, payload: initiativePayload(row) };
        } catch (failure) {
          setInvalidField(`${key}:${failure.field}`);
          const input = fieldRefs.current.get(`${key}:${failure.field}`);
          input?.scrollIntoView({
            block: "center",
            inline: "center",
            behavior: "smooth",
          });
          input?.focus({ preventScroll: true });
          throw failure;
        }
      });
    } catch (failure) {
      setError(failure.message);
      return;
    }
    setBusy(true);
    setInvalidField(null);
    setError("");
    let saved = 0;
    try {
      for (const { key, row, payload } of pending) {
        if (apiMode) {
          const ok = await manageAdminBudget(
            key.startsWith("new:") ? "create" : "edit",
            row,
            payload,
          );
          if (!ok) throw Error("当前会话或版本已变化，请重新检查未保存项目。");
        } else {
          mutate((draft) =>
            key.startsWith("new:")
              ? E.applyAdminConfiguration(draft, [], identity, roles, [payload])
              : E.editAdminBudget(draft, row.id, payload, identity, roles),
          );
        }
        saved += 1;
        setDrafts((old) => {
          const next = { ...old };
          delete next[key];
          return next;
        });
      }
      setEditMode(false);
      notify(`已保存 ${saved} 个 Initiative。`);
    } catch (failure) {
      setError(
        `${saved ? `已保存 ${saved} 项；其余修改仍保留。` : ""}${failure.message}`,
      );
    } finally {
      setBusy(false);
    }
  };
  const choice = (row, key, values, label) => (
    <NativeSelect
      aria-label={`${row.name || "新增项目"} ${label}`}
      value={row[key]}
      disabled={busy || previewMode}
      onChange={(event) => edit(row, key, event.target.value)}
    >
      {[...new Set([row[key], ...values])].map((value) => (
        <NativeSelectOption key={value} value={value}>
          {value || "请选择"}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
  if (!editMode)
    return (
      <>
        <VersionBar />
        <Card className="panel studio-admin-panel">
          <div className="panel-header">
            <h2>{state.currentVersionId || "当前版本"} · 项目清单与预算</h2>
            <div className="actions">
              <AdminImportPanel kind="initiatives" />
              <Button
                disabled={previewMode}
                onClick={() => {
                  setEditMode(true);
                  add();
                }}
              >
                ＋ 本版新增 Initiative
              </Button>
              <Button disabled={previewMode} onClick={() => setEditMode(true)}>
                编辑
              </Button>
            </div>
          </div>
          <div className="table-scroll">
            <Table containerClassName="overflow-visible">
              <TableHeader>
                <TableRow>
                  {[
                    "编码 / Initiative",
                    "Sector",
                    "Department",
                    "Resource Type",
                    "Owner",
                    "预算（万）",
                    "本版状态",
                  ].map((label) => (
                    <TableHead key={label}>{label}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <span>{item.name}</span>
                      <small className="block muted">
                        {item.initiativeKey || item.id}
                      </small>
                    </TableCell>
                    <TableCell>{item.sector}</TableCell>
                    <TableCell>{item.department}</TableCell>
                    <TableCell>{item.resourceType}</TableCell>
                    <TableCell>
                      {owners.find((owner) => owner.value === item.ownerId)
                        ?.label || item.ownerId}
                    </TableCell>
                    <TableCell sortValue={item.budget / 10000}>
                      {num(item.budget / 10000)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={
                          item.enabled === false
                            ? "v19-disabled-status"
                            : "v19-enabled-status"
                        }
                      >
                        {item.enabled === false ? "本版取消" : "启用"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      </>
    );
  return (
    <>
      <VersionBar />
      <Card className="panel studio-admin-panel v19-inline-config">
        <div className="panel-header">
          <div>
            <h2>本版项目配置 · 编辑中</h2>
            <p>
              {rows.length} 项 · 总预算{" "}
              {num(
                rows.reduce((sum, row) => sum + (Number(row.budget) || 0), 0) /
                  10000,
              )}{" "}
              万
            </p>
          </div>
          <div className="actions">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setDrafts({});
                setError("");
                setEditMode(false);
              }}
            >
              取消修改
            </Button>
            <Button
              variant="outline"
              disabled={busy || previewMode}
              onClick={add}
            >
              ＋ 新增 Initiative
            </Button>
            <Button
              disabled={busy || previewMode || !Object.keys(drafts).length}
              onClick={save}
            >
              {busy ? "保存中…" : "统一保存"}
            </Button>
          </div>
        </div>
        <p className="studio-table-note">
          修改后请为每个项目填写变化原因（必填）；预算单位为元。校验失败时会定位到需要补充的字段。保存配置会撤回该项目的本版提交，版本需重新发布。
        </p>
        <div className="studio-table-toolbar">
          <Input
            type="search"
            placeholder="搜索编码 / Initiative / Owner"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <span>
            显示 {filtered.length} / {rows.length} 项
          </span>
        </div>
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="table-scroll">
          <Table containerClassName="overflow-visible">
            <TableHeader>
              <TableRow>
                {[
                  "编码 / Initiative",
                  "Sector",
                  "部门",
                  "资源大类",
                  "Owner",
                  "预算（元）",
                  "状态",
                  "变化原因（必填）",
                  "承接编码",
                ].map((label) => (
                  <TableHead key={label}>{label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => (
                <TableRow key={row._key} data-dirty={!!drafts[row._key]}>
                  <TableCell>
                    <small>{row.initiativeKey || row.id || "保存后生成"}</small>
                    <Input
                      aria-label={`${row.id || "新增项目"} Initiative 名称`}
                      ref={(node) => {
                        const key = `${row._key}:name`;
                        if (node) fieldRefs.current.set(key, node);
                        else fieldRefs.current.delete(key);
                      }}
                      aria-invalid={invalidField === `${row._key}:name`}
                      value={row.name}
                      disabled={busy || previewMode}
                      onChange={(event) =>
                        edit(row, "name", event.target.value)
                      }
                    />
                  </TableCell>
                  <TableCell>
                    {choice(
                      row,
                      "sector",
                      ["PCMO", "CRTO", "B2B", "OEM"],
                      "Sector",
                    )}
                  </TableCell>
                  <TableCell>
                    {choice(row, "department", ["MKT", "ICE", "CAPEX"], "部门")}
                  </TableCell>
                  <TableCell>
                    {choice(
                      row,
                      "resourceType",
                      ["MRD", "SP&A", "ICE Rebate", "Capex"],
                      "资源大类",
                    )}
                  </TableCell>
                  <TableCell>
                    <NativeSelect
                      aria-label={`${row.name || "新增项目"} Owner`}
                      ref={(node) => {
                        const key = `${row._key}:ownerId`;
                        if (node) fieldRefs.current.set(key, node);
                        else fieldRefs.current.delete(key);
                      }}
                      aria-invalid={invalidField === `${row._key}:ownerId`}
                      value={row.ownerId}
                      disabled={busy || previewMode}
                      onChange={(event) =>
                        edit(row, "ownerId", event.target.value)
                      }
                    >
                      <NativeSelectOption value="">请选择</NativeSelectOption>
                      {row.ownerId &&
                        !owners.some(
                          (owner) => owner.value === row.ownerId,
                        ) && (
                          <NativeSelectOption value={row.ownerId}>
                            {row.ownerId}
                          </NativeSelectOption>
                        )}
                      {owners.map((owner) => (
                        <NativeSelectOption
                          key={owner.value}
                          value={owner.value}
                        >
                          {owner.label}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </TableCell>
                  <TableCell>
                    <MoneyInput
                      aria-label={`${row.name || "新增项目"} 预算（元）`}
                      inputRef={(node) => {
                        const key = `${row._key}:budget`;
                        if (node) fieldRefs.current.set(key, node);
                        else fieldRefs.current.delete(key);
                      }}
                      aria-invalid={invalidField === `${row._key}:budget`}
                      value={row.budget}
                      disabled={busy || previewMode}
                      onValueChange={(value) => edit(row, "budget", value)}
                    />
                  </TableCell>
                  <TableCell>
                    <NativeSelect
                      aria-label={`${row.name || "新增项目"} 状态`}
                      value={row.enabled === false ? "off" : "on"}
                      disabled={busy || previewMode}
                      onChange={(event) =>
                        edit(row, "enabled", event.target.value === "on")
                      }
                    >
                      <NativeSelectOption value="on">启用</NativeSelectOption>
                      <NativeSelectOption value="off">停用</NativeSelectOption>
                    </NativeSelect>
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label={`${row.name || "新增项目"} 变化原因`}
                      ref={(node) => {
                        const key = `${row._key}:reason`;
                        if (node) fieldRefs.current.set(key, node);
                        else fieldRefs.current.delete(key);
                      }}
                      aria-invalid={invalidField === `${row._key}:reason`}
                      placeholder="必填：说明此次修改原因"
                      required
                      value={row.reason}
                      maxLength={160}
                      disabled={busy || previewMode}
                      onChange={(event) =>
                        edit(row, "reason", event.target.value)
                      }
                    />
                  </TableCell>
                  <TableCell>{row.initiativeKey || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="footerhint">
          预算与归属变化保留原名单和金额，变更后需重新发布；取消项目保留编码和历史。承接编码使用已有版本关联，不能手工猜配。
        </p>
      </Card>
    </>
  );
}

export function AuditPage({ audit }) {
  const [query, setQuery] = useState("");
  const filtered = audit.filter((row) =>
    JSON.stringify(row).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <Card className="panel studio-admin-panel gap-4 p-4">
      <div className="studio-table-toolbar">
        <span>共 {filtered.length} 条操作记录</span>
        <Input
          type="search"
          placeholder="搜索操作人 / 对象 / 动作"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="table-scroll">
        <Table containerClassName="overflow-visible">
          <TableHeader>
            <TableRow>
              <TableHead>时间</TableHead>
              <TableHead>操作人</TableHead>
              <TableHead>动作</TableHead>
              <TableHead>对象</TableHead>
              <TableHead>摘要</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((row, index) => (
              <TableRow key={row.id || index}>
                <TableCell>{time(row.at || row.createdAt)}</TableCell>
                <TableCell>
                  {typeof row.actor === "object"
                    ? row.actor?.label || row.operator || "—"
                    : row.actor || row.user || row.operator || "—"}
                </TableCell>
                <TableCell>{row.action || row.type || "—"}</TableCell>
                <TableCell>
                  {row.object ||
                    row.target ||
                    row.scope ||
                    row.initiativeId ||
                    "—"}
                </TableCell>
                <TableCell>
                  {row.detail || row.note || row.message || row.summary || "—"}
                </TableCell>
              </TableRow>
            ))}
            {!filtered.length && (
              <TableRow>
                <TableCell colSpan="5">
                  <div className="empty">暂无操作审计记录。</div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

export function AdminStudioPage() {
  const context = useWorkbench();
  const {
    page,
    view,
    state,
    identity,
    roles,
    apiMode,
    mutate,
    manageAdminBudget,
    notify,
  } = context;
  if (identity.role !== "admin")
    return <div className="empty">仅系统管理员可访问。</div>;
  const items = view.initiatives || [],
    meta = ADMIN_META[page] || ADMIN_META["admin-versions"];
  return (
    <>
      <PageHead eyebrow={meta[0]} title={meta[1]} />
      {page === "admin-versions" && <PlanningVersionsPage />}
      {page === "admin-initiatives" && (
        <InitiativesPage
          key={state.currentVersionId || "legacy"}
          items={items}
          state={state}
          previewMode={context.previewMode}
          identity={identity}
          roles={roles}
          apiMode={apiMode}
          mutate={mutate}
          manageAdminBudget={manageAdminBudget}
          notify={notify}
        />
      )}
      {page === "admin-users" && (
        <>
          <Card className="panel studio-admin-panel gap-4 p-4">
            <AdminUsersPanel />
          </Card>
          <HistoricalResourceSettings
            mapping={state.departmentResources || {}}
            roleMapping={state.roleResources}
            departments={[...new Set(items.map((item) => item.department))]}
            saveConfig={context.saveConfig}
            readOnly={context.previewMode}
          />
        </>
      )}
      {page === "admin-enums" && <StudioConfiguration />}
      {page === "admin-thresholds" && <StudioConfiguration thresholds />}
      {page === "admin-audit" && <AuditPage audit={state.audit || []} />}
    </>
  );
}
