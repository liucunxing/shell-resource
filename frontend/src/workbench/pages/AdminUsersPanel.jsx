import { AdminImportPanel } from "./AdminImportPanel";
import { InitiativeChip } from "./V19PortfolioVisuals";
import { ResourceDetailDrawer } from "./ResourceDetailDrawer";
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../../components/ui/dialog";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Label } from "../../components/ui/label";
import { Input } from "../../components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "../../components/ui/native-select";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "../../components/ui/table";
import { Badge } from "../../components/ui/badge";
import { Checkbox } from "../../components/ui/checkbox";
import { useEffect, useState } from "react";
import E from "../domain/engine.js";
import * as api from "../api.js";
import { useWorkbench } from "../WorkbenchContext.jsx";
import { departmentExpenseLimit } from "../domain/history-permissions";
import "./admin-users-v19.css";

const PAGE_SIZE = 20;
const DEPARTMENTS = ["MKT", "ICE", "CAPEX"];
const SECTORS = ["PCMO", "CRTO", "B2B", "OEM"];
const HISTORY_RESOURCES = ["ICE Rebate", "MRD", "SP&A", "Capex"];
const EMPTY_FILTERS = {
  email: "",
  name: "",
  role: "",
  department: "",
  sector: "",
};
const EMPTY_USER = {
  email: "",
  display_name: "",
  role: "owner",
  department: ["MKT"],
  sector: [],
  enabled: true,
  affiliation_sector: "",
  affiliation_department: "",
  history_resources: null,
};
const ROLE_LABELS = {
  owner: "Initiative Owner",
  lead: "部门负责人",
  management: "最高管理层",
  admin: "系统管理员",
};
export const userDepartmentOptions = (current) => [
  ...new Set([...DEPARTMENTS, ...E.departments(current)].filter(Boolean)),
];
export const departmentAfterRoleChange = (role, current) =>
  ["owner", "lead"].includes(role)
    ? E.departments(current).length
      ? E.departments(current)
      : [DEPARTMENTS[0]]
    : [];
export const sectorAfterRoleChange = (role, current) => {
  if (!["owner", "lead"].includes(role)) return [];
  return role === "owner" ? current.slice(0, 1) : current;
};
export const toggleSectorSelection = (role, current, sector) => {
  if (current.includes(sector))
    return current.filter((value) => value !== sector);
  return role === "owner" ? [sector] : [...current, sector];
};
export const ownerSectorOptions = (department, leadSectorsByDepartment = {}) =>
  E.departments(department).length
    ? SECTORS.filter((sector) =>
        E.departments(department).every((dep) =>
          (leadSectorsByDepartment[dep] || []).includes(sector),
        ),
      )
    : [];
export const hasValidAffiliation = (user) =>
  SECTORS.includes(user.affiliation_sector) &&
  DEPARTMENTS.includes(user.affiliation_department);
export const initiativesForUser = (user, items = []) =>
  items.filter(
    (item) =>
      String(item.ownerId || "")
        .trim()
        .toLowerCase() ===
      String(user.email || "")
        .trim()
        .toLowerCase(),
  );

function UserDialog({
  title,
  children,
  onClose,
  onConfirm,
  confirmLabel,
  saving,
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent
        size="form"
        showCloseButton={false}
        aria-describedby={undefined}
        onEscapeKeyDown={(event) => {
          if (saving) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (saving) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DialogBody>{children}</DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={saving}
          >
            {onConfirm ? "取消" : "关闭"}
          </Button>
          {onConfirm && (
            <Button
              type="button"
              variant={
                confirmLabel?.includes("删除") ? "destructive" : "default"
              }
              onClick={onConfirm}
              disabled={saving}
            >
              {saving ? "处理中…" : confirmLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AdminUsersPanel() {
  const {
    state,
    data,
    roles,
    identity,
    notify,
    refresh,
    previewMode,
    startUserPreview,
    switchingPreview,
    loading: workspaceLoading,
  } = useWorkbench();
  const [initiativeDetail, setInitiativeDetail] = useState(null);
  const [draftFilters, setDraftFilters] = useState(EMPTY_FILTERS);
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [dialog, setDialog] = useState(null);
  const [form, setForm] = useState(EMPTY_USER);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const ownerAllowedSectors = ownerSectorOptions(
    form.department,
    result.lead_sectors_by_department,
  );

  useEffect(() => {
    // A workspace refresh also reloads roles and permissions. Wait for its
    // final scope before issuing the list request, instead of fetching twice.
    if (workspaceLoading) return;
    let active = true;
    setLoading(true);
    setLoadError("");
    api
      .listAdminUsers(filters, PAGE_SIZE, offset)
      .then((data) => {
        if (active) setResult(data);
      })
      .catch((error) => {
        if (active) setLoadError(error.message || "人员列表加载失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [filters, offset, revision, identity?.email, roles, workspaceLoading]);

  const close = () => {
    if (!saving) {
      setDialog(null);
      setFormError("");
    }
  };
  const open = (kind, user = null) => {
    setFormError("");
    if (user?.has_initiatives && kind === "delete") {
      setDialog({ kind: "blocked", user });
      return;
    }
    setForm(
      user
        ? {
            email: user.email,
            display_name: user.display_name,
            role: user.role,
            department: E.departments(user),
            sector: user.sector || [],
            enabled: user.enabled,
            affiliation_sector: user.affiliation_sector || "",
            affiliation_department: user.affiliation_department || "",
            history_resources: user.history_resources ?? null,
          }
        : { ...EMPTY_USER },
    );
    setDialog({ kind, user });
  };

  async function persist() {
    if (!dialog || saving) return;
    if (dialog.kind !== "delete") {
      const email = form.email.trim().toLowerCase();
      const displayName = form.display_name.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setFormError("请输入有效的邮箱地址。");
        return;
      }
      if (!displayName) {
        setFormError("姓名不能为空。");
        return;
      }
      if (!hasValidAffiliation(form)) {
        setFormError("所有角色都必须选择所属 Sector 和 Department。");
        return;
      }
      if (["owner", "lead"].includes(form.role) && !form.department.length) {
        setFormError("Owner 和部门负责人必须填写部门。");
        return;
      }
      if (form.role === "owner" && form.sector.length !== 1) {
        setFormError("Owner 必须选择一条业务线。");
        return;
      }
      if (
        form.role === "owner" &&
        !ownerAllowedSectors.includes(form.sector[0])
      ) {
        setFormError("Owner 的业务线必须在所有所选部门负责人的业务线范围内。");
        return;
      }
      if (
        form.role === "lead" &&
        !(form.sector.length >= 1 && form.sector.length <= 4)
      ) {
        setFormError("部门负责人必须选择一至四条业务线。");
        return;
      }
    }
    setSaving(true);
    setFormError("");
    try {
      if (dialog.kind === "delete") {
        await api.deleteAdminUser(dialog.user.id);
      } else {
        const payload = {
          email: form.email.trim().toLowerCase(),
          display_name: form.display_name.trim(),
          role: form.role,
          department: ["owner", "lead"].includes(form.role)
            ? form.department
            : [],
          sector: ["owner", "lead"].includes(form.role) ? form.sector : [],
          enabled: form.enabled,
          affiliation_sector: form.affiliation_sector,
          affiliation_department: form.affiliation_department,
          history_resources:
            form.history_resources == null
              ? null
              : form.history_resources.filter((resource) =>
                  departmentExpenseLimit(form.affiliation_department).includes(
                    resource,
                  ),
                ),
        };
        if (dialog.kind === "create") await api.createAdminUser(payload);
        else await api.updateAdminUser(dialog.user.id, payload);
      }
      const action = { create: "新增", edit: "修改", delete: "删除" }[
        dialog.kind
      ];
      setDialog(null);
      notify(`人员${action}成功。`);
      if (dialog.kind === "delete" && result.items.length === 1 && offset > 0)
        setOffset(Math.max(0, offset - PAGE_SIZE));
      else setRevision((value) => value + 1);
      await refresh({ preservePage: true });
    } catch (error) {
      if (
        dialog.kind === "delete" &&
        error.status === 409 &&
        error.message?.includes("Initiative")
      ) {
        setDialog({ kind: "blocked", user: dialog.user });
      } else {
        setFormError(error.message || "操作失败，请重试。");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {initiativeDetail && (
        <ResourceDetailDrawer
          detail={initiativeDetail}
          items={state.initiatives || []}
          dealers={data.dealers || []}
          budgetReasons={state.budgetReasons}
          ytdCutoffMonth={state.ytdCutoffMonth}
          onClose={() => setInitiativeDetail(null)}
        />
      )}
      <div className="user-list-heading">
        <h2>用户清单 · {result.total} 人</h2>
        <div className="actions">
          <AdminImportPanel
            kind="users"
          />
          <Button
            variant="ghost"
            size="sm"
            type="button"
            aria-expanded={filtersVisible}
            onClick={() => setFiltersVisible((value) => !value)}
          >
            筛选
          </Button>
          <Button
            variant="default"
            type="button"
            disabled={previewMode}
            onClick={() => open("create")}
          >
            ＋ 新增用户
          </Button>
        </div>
      </div>
      {filtersVisible && (
        <form
          className="user-filters"
          onSubmit={(event) => {
            event.preventDefault();
            setOffset(0);
            setFilters({ ...draftFilters });
          }}
        >
          <Label className="form-field">
            邮箱
            <Input
              value={draftFilters.email}
              maxLength={255}
              placeholder="模糊搜索邮箱"
              onChange={(event) =>
                setDraftFilters({ ...draftFilters, email: event.target.value })
              }
            />
          </Label>
          <Label className="form-field">
            姓名
            <Input
              value={draftFilters.name}
              maxLength={255}
              placeholder="模糊搜索姓名"
              onChange={(event) =>
                setDraftFilters({ ...draftFilters, name: event.target.value })
              }
            />
          </Label>
          <Label className="form-field">
            角色
            <NativeSelect
              value={draftFilters.role}
              onChange={(event) =>
                setDraftFilters({ ...draftFilters, role: event.target.value })
              }
            >
              <NativeSelectOption value="">全部角色</NativeSelectOption>
              {Object.entries(ROLE_LABELS).map(([value, label]) => (
                <NativeSelectOption key={value} value={value}>
                  {label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Label>
          <Label className="form-field">
            部门
            <Input
              list="admin-user-filter-departments"
              value={draftFilters.department}
              maxLength={32}
              placeholder="全部部门"
              onChange={(event) =>
                setDraftFilters({
                  ...draftFilters,
                  department: event.target.value,
                })
              }
            />
            <datalist id="admin-user-filter-departments">
              {DEPARTMENTS.map((value) => (
                <NativeSelectOption key={value} value={value} />
              ))}
            </datalist>
          </Label>
          <Label className="form-field">
            业务线
            <NativeSelect
              value={draftFilters.sector}
              onChange={(event) =>
                setDraftFilters({ ...draftFilters, sector: event.target.value })
              }
            >
              <NativeSelectOption value="">全部业务线</NativeSelectOption>
              {SECTORS.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {value}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Label>
          <div className="user-filter-actions">
            <Button variant="default" type="submit">
              搜索
            </Button>
            <Button
              variant="outline"
              type="button"
              onClick={() => {
                setDraftFilters({ ...EMPTY_FILTERS });
                setFilters({ ...EMPTY_FILTERS });
                setOffset(0);
              }}
            >
              重置
            </Button>
          </div>
        </form>
      )}
      {loadError && (
        <Alert variant="destructive" className="note-box error" role="alert">
          <AlertDescription>
            {loadError}{" "}
            <Button
              variant="outline"
              type="button"
              onClick={() => setRevision((v) => v + 1)}
            >
              重试
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <div
        className={`user-list-wrap${loading ? " is-loading" : ""}`}
        aria-busy={loading}
      >
        <div className="table-scroll">
          <Table
            containerClassName="overflow-visible"
            className="contract-table v19-user-table"
          >
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>姓名</TableHead>
                <TableHead>登录账号</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>授权范围</TableHead>
                <TableHead>
                  负责 Initiative
                  {state?.currentVersionId
                    ? `（${state.currentVersionId}）`
                    : ""}
                </TableHead>
                <TableHead>状态</TableHead>
                <TableHead>操作</TableHead>
                <TableHead>所属部门</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.items.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="v19-user-id" title={String(user.id)}>
                    {user.id}
                  </TableCell>
                  <TableCell>{user.display_name}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>{ROLE_LABELS[user.role] || user.role}</TableCell>
                  <TableCell>
                    {user.role === "owner"
                      ? "本人负责的 Initiative"
                      : user.role === "management"
                        ? "全部 Sector / 部门"
                        : user.role === "admin"
                          ? "系统配置"
                          : (user.sector || []).flatMap((sector) =>
                              E.departments(user).map((department) => (
                                <Badge
                                  variant="outline"
                                  key={`${sector}-${department}`}
                                >
                                  {sector} / {department}
                                </Badge>
                              )),
                            )}
                  </TableCell>
                  <TableCell className="v19-user-initiatives">
                    {initiativesForUser(user, state?.initiatives).length ? (
                      <div className="v19-user-initiative-grid">
                        {initiativesForUser(user, state?.initiatives).map(
                          (item) => (
                            <InitiativeChip
                              key={item.id}
                              item={item}
                              name={item.name}
                              onClick={() =>
                                setInitiativeDetail({
                                  type: "initiative",
                                  initiativeId: String(item.id),
                                })
                              }
                            />
                          ),
                        )}
                      </div>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={`badge ${user.enabled ? "teal" : "amber"}`}
                    >
                      {user.enabled ? "启用" : "停用"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="actions">
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        disabled={previewMode}
                        onClick={() => open("edit", user)}
                      >
                        编辑
                      </Button>
                      {!previewMode &&
                        identity.role === "admin" &&
                        user.email !== identity.email && (
                          <Button
                            variant="outline"
                            size="sm"
                            type="button"
                            disabled={!user.enabled || switchingPreview}
                            title={
                              user.enabled
                                ? "按该用户权限只读查看工作台"
                                : "停用用户无法模拟查看"
                            }
                            onClick={() => startUserPreview(user)}
                          >
                            模拟进入
                          </Button>
                        )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {hasValidAffiliation(user)
                      ? `${user.affiliation_sector} / ${user.affiliation_department}`
                      : "待配置"}
                    <small className="v19-user-permission-source">
                      {user.history_resources == null
                        ? "沿用所属部门"
                        : `用户单独配置：${user.history_resources.join("、") || "全部隐藏"}`}
                    </small>
                  </TableCell>
                </TableRow>
              ))}
              {!loading && !result.items.length && (
                <TableRow>
                  <TableCell colSpan={9}>暂无匹配人员。</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        {loading && (
          <div className="user-list-loading" role="status">
            正在加载人员…
          </div>
        )}
      </div>
      <p className="small-text muted">
        生产系统通过 SSO 登录，账号与 AD 对齐；停用用户不能登录，其负责的
        Initiative 需在“项目配置”中改派 Owner。模拟进入按实际权限只读查看。
      </p>
      <div className="user-list-footer">
        <span>
          共 {result.total} 人 · 第 {Math.floor(offset / PAGE_SIZE) + 1} /{" "}
          {Math.max(1, Math.ceil(result.total / PAGE_SIZE))} 页
        </span>
        <div className="actions">
          <Button
            variant="outline"
            size="sm"
            type="button"
            disabled={loading || offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            上一页
          </Button>
          <Button
            variant="outline"
            size="sm"
            type="button"
            disabled={loading || offset + PAGE_SIZE >= result.total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            下一页
          </Button>
        </div>
      </div>
      {dialog && (
        <UserDialog
          title={
            {
              create: "新增人员",
              edit: "修改人员",
              delete: "确认删除人员",
              blocked: "无法修改或删除",
            }[dialog.kind]
          }
          onClose={close}
          onConfirm={
            ["create", "edit", "delete"].includes(dialog.kind)
              ? persist
              : undefined
          }
          confirmLabel={dialog.kind === "delete" ? "确认删除" : "保存"}
          saving={saving}
        >
          {dialog.kind === "blocked" && (
            <Alert variant="destructive" className="note-box warn" role="alert">
              <AlertDescription>
                {dialog.user.email} 当前已有 Initiative
                预算事项，不可修改或删除。
              </AlertDescription>
            </Alert>
          )}
          {dialog.kind === "delete" && (
            <p>
              确定删除 <strong>{dialog.user.email}</strong>
              ？删除后该邮箱将无法登录工作台。
            </p>
          )}
          {["create", "edit"].includes(dialog.kind) && (
            <>
              <Label className="form-field">
                邮箱
                <Input
                  disabled={dialog.user?.has_initiatives}
                  type="email"
                  maxLength={255}
                  value={form.email}
                  autoFocus
                  onChange={(event) =>
                    setForm({ ...form, email: event.target.value })
                  }
                />
              </Label>
              <Label className="form-field">
                姓名
                <Input
                  disabled={dialog.user?.has_initiatives}
                  maxLength={255}
                  value={form.display_name}
                  onChange={(event) =>
                    setForm({ ...form, display_name: event.target.value })
                  }
                />
              </Label>
              <Label className="form-field">
                角色
                <NativeSelect
                  disabled={dialog.user?.has_initiatives}
                  value={form.role}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      role: event.target.value,
                      department: departmentAfterRoleChange(
                        event.target.value,
                        form.department,
                      ),
                      sector: sectorAfterRoleChange(
                        event.target.value,
                        form.sector,
                      ),
                    })
                  }
                >
                  {Object.entries(ROLE_LABELS).map(([value, label]) => (
                    <NativeSelectOption key={value} value={value}>
                      {label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Label>
              {dialog.user?.has_initiatives && (
                <Alert role="note" className="note-box">
                  <AlertDescription>
                    已有预算事项，可调整部门、所属归属和费用列；仍有项目的授权部门必须保留。
                  </AlertDescription>
                </Alert>
              )}
              <fieldset className="form-field">
                <legend>所属部门（所有角色必填）</legend>
                <Label className="form-field">
                  所属 Sector
                  <NativeSelect
                    required
                    value={form.affiliation_sector}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        affiliation_sector: event.target.value,
                      })
                    }
                  >
                    <NativeSelectOption value="">
                      请选择 Sector
                    </NativeSelectOption>
                    {SECTORS.map((value) => (
                      <NativeSelectOption key={value} value={value}>
                        {value}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Label>
                <Label className="form-field">
                  所属 Department
                  <NativeSelect
                    required
                    value={form.affiliation_department}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        affiliation_department: event.target.value,
                      })
                    }
                  >
                    <NativeSelectOption value="">
                      请选择 Department
                    </NativeSelectOption>
                    {DEPARTMENTS.map((value) => (
                      <NativeSelectOption key={value} value={value}>
                        {value}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Label>
                <small>
                  仅用于关联历史费用权限，不自动改变下方业务授权。未配置有效归属时不显示费用明细。
                </small>
              </fieldset>
              <fieldset className="form-field">
                <legend>历史费用列范围</legend>
                <Label>
                  <Checkbox
                    checked={form.history_resources !== null}
                    onCheckedChange={(checked) =>
                      setForm({
                        ...form,
                        history_resources: checked === true ? [] : null,
                      })
                    }
                  />
                  为此用户收窄可见费用列
                </Label>
                {form.history_resources !== null && (
                  <div className="sector-choice-group">
                    {HISTORY_RESOURCES.map((resource) => (
                      <Label key={resource}>
                        <Checkbox
                          disabled={
                            !hasValidAffiliation(form) ||
                            !departmentExpenseLimit(
                              form.affiliation_department,
                            ).includes(resource)
                          }
                          checked={
                            departmentExpenseLimit(
                              form.affiliation_department,
                            ).includes(resource) &&
                            form.history_resources.includes(resource)
                          }
                          onCheckedChange={(checked) =>
                            setForm({
                              ...form,
                              history_resources:
                                checked === true
                                  ? [...form.history_resources, resource]
                                  : form.history_resources.filter(
                                      (item) => item !== resource,
                                    ),
                            })
                          }
                        />
                        {resource}
                      </Label>
                    ))}
                  </div>
                )}
                <small>
                  只能在所属部门对应的大类内收窄；单独配置后不勾选即全部隐藏，管理层和管理员也不跨部门扩权。历史总额与
                  Yield 等公共指标不受影响。
                </small>
              </fieldset>
              {["owner", "lead"].includes(form.role) && (
                <div className="form-field">
                  部门（可多选）
                  <div
                    className="sector-choice-group"
                    role="group"
                    aria-label="选择部门"
                  >
                    {userDepartmentOptions(form.department).map((value) => (
                      <Button
                        variant={
                          form.department.includes(value)
                            ? "default"
                            : "outline"
                        }
                        key={value}
                        type="button"
                        className="sector-choice"
                        aria-pressed={form.department.includes(value)}
                        onClick={() => {
                          const department = form.department.includes(value)
                            ? form.department.filter((dep) => dep !== value)
                            : [...form.department, value];
                          const allowed = ownerSectorOptions(
                            department,
                            result.lead_sectors_by_department,
                          );
                          setForm({
                            ...form,
                            department,
                            sector:
                              form.role === "owner" &&
                              !dialog.user?.has_initiatives &&
                              !allowed.includes(form.sector[0])
                                ? []
                                : form.sector,
                          });
                        }}
                      >
                        {value}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
              {["owner", "lead"].includes(form.role) && (
                <div className="form-field">
                  业务线
                  <div
                    className="sector-choice-group"
                    role="group"
                    aria-label="选择业务线"
                  >
                    {SECTORS.map((value) => (
                      <Button
                        variant={
                          form.sector.includes(value) ? "default" : "outline"
                        }
                        key={value}
                        type="button"
                        className="sector-choice"
                        aria-pressed={form.sector.includes(value)}
                        disabled={
                          dialog.user?.has_initiatives ||
                          (form.role === "owner" &&
                            !ownerAllowedSectors.includes(value))
                        }
                        onClick={() =>
                          setForm({
                            ...form,
                            sector: toggleSectorSelection(
                              form.role,
                              form.sector,
                              value,
                            ),
                          })
                        }
                      >
                        {value}
                      </Button>
                    ))}
                  </div>
                  <small>
                    {form.role === "owner"
                      ? ownerAllowedSectors.length
                        ? `Owner 仅可选择所有所选部门负责人共同覆盖的业务线：${ownerAllowedSectors.join("、")}。`
                        : "请先为该部门配置启用的部门负责人及其业务线。"
                      : "部门负责人可选择一至四条业务线。"}
                  </small>
                </div>
              )}
              <Label className="user-enabled-field">
                <Checkbox
                  disabled={dialog.user?.has_initiatives}
                  checked={form.enabled}
                  onCheckedChange={(checked) =>
                    setForm({ ...form, enabled: checked === true })
                  }
                />
                启用该用户
              </Label>
              {dialog.kind === "edit" && (
                <Button
                  variant="destructive"
                  type="button"
                  disabled={previewMode || saving}
                  onClick={() => open("delete", dialog.user)}
                >
                  删除用户
                </Button>
              )}
            </>
          )}
          {formError && (
            <Alert
              variant="destructive"
              className="note-box error"
              role="alert"
            >
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
        </UserDialog>
      )}
    </>
  );
}
