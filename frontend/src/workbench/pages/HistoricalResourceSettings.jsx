import { Alert, AlertDescription } from "../../components/ui/alert";
import { Card } from "../../components/ui/card";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "../../components/ui/table";
import { Checkbox } from "../../components/ui/checkbox";
import { Button } from "../../components/ui/button";
import { Label } from "../../components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "../../components/ui/native-select";
import { useEffect, useState } from "react";
import { useWorkbench } from "../WorkbenchContext.jsx";
import * as api from "../api.js";
import { hasValidAffiliation } from "./AdminUsersPanel.jsx";
import { departmentExpenseFields, departmentExpenseLimit } from "../domain/history-permissions";
export { departmentExpenseFields, departmentExpenseLimit } from "../domain/history-permissions";

const resources = ["ICE Rebate", "MRD", "SP&A", "Capex"];
const emptyMapping = {};
const scopedDepartments = ["PCMO", "CRTO", "B2B", "OEM"].flatMap((sector) =>
  ["MKT", "ICE", "CAPEX"].map((department) => `${sector}|${department}`),
);

export function historyPermissionPayload(user, historyResources) {
  if (!hasValidAffiliation(user))
    throw new Error(
      `${user.display_name || user.email}：请先在用户编辑中维护真实所属部门。`,
    );
  if (historyResources?.some((field) => !departmentExpenseLimit(user.affiliation_department).includes(field)))
    throw new Error("历史费用权限不能超出本人所属部门对应的大类。");
  return {
    email: user.email,
    display_name: user.display_name,
    role: user.role,
    department: user.department || [],
    sector: user.sector || [],
    enabled: user.enabled,
    affiliation_sector: user.affiliation_sector,
    affiliation_department: user.affiliation_department,
    history_resources: historyResources,
  };
}

export function HistoricalResourceSettings({
  mapping = emptyMapping,
  departments = [],
  saveConfig,
  readOnly = false,
}) {
  const context = useWorkbench();
  const [draft, setDraft] = useState(mapping);
  const [users, setUsers] = useState([]);
  const [userDraft, setUserDraft] = useState({});
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [departmentError, setDepartmentError] = useState("");
  const names = [
    ...new Set([...Object.keys(draft), ...departments, ...scopedDepartments]),
  ].sort();
  const [selected, setSelected] = useState(
    () => names.find((name) => name.includes("|")) || names[0] || "",
  );
  const selectedDepartment = names.includes(selected)
    ? selected
    : names[0] || "";
  const customDepartment = Object.hasOwn(draft, selectedDepartment);
  useEffect(() => setDraft(mapping), [mapping]);
  useEffect(() => {
    let active = true;
    setUsersLoading(true);
    setUsersError("");
    (async () => {
      const all = [];
      let total = Infinity;
      while (all.length < total) {
        const page = await api.listAdminUsers({}, 100, all.length);
        total = Number(page.total || 0);
        if (!page.items?.length) break;
        all.push(...page.items);
      }
      if (active) setUsers(all);
    })()
      .catch((failure) => {
        if (active) setUsersError(failure.message || "用户权限加载失败");
      })
      .finally(() => {
        if (active) setUsersLoading(false);
      });
    return () => {
      active = false;
    };
  }, [context?.roles, context?.identity?.email]);
  const toggle = (setter, name, resource, enabled) =>
    setter((current) => ({
      ...current,
      [name]: enabled
        ? [...(current[name] || []), resource]
        : (current[name] || []).filter((item) => item !== resource),
    }));
  async function savePermissions() {
    if (readOnly || busy) return;
    setBusy(true);
    setError("");
    const savedUsers = [];
    let currentUser;
    try {
      for (const user of users.filter((user) =>
        Object.hasOwn(userDraft, user.id),
      )) {
        currentUser = user;
        await api.updateAdminUser(
          user.id,
          historyPermissionPayload(user, userDraft[user.id]),
        );
        savedUsers.push(user.display_name || user.email);
        setUsers((current) =>
          current.map((item) =>
            item.id === user.id
              ? { ...item, history_resources: userDraft[user.id] }
              : item,
          ),
        );
        setUserDraft((current) => {
          const next = { ...current };
          delete next[user.id];
          return next;
        });
      }
      await context?.refresh?.({ preservePage: true });
      context?.notify?.(
        savedUsers.length
          ? `权限已保存：${savedUsers.join("、")}。`
          : "没有待保存的用户权限修改。",
      );
    } catch (failure) {
      setError(
        `${savedUsers.length ? `已保存用户：${savedUsers.join("、")}。` : ""}${currentUser ? `${currentUser.display_name || currentUser.email} 保存失败：` : ""}${failure.message || "权限保存失败，请重试"}`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function saveDepartment() {
    if (readOnly || busy || !selectedDepartment) return;
    setBusy(true);
    setDepartmentError("");
    try {
      const bounded = Object.fromEntries(Object.entries(draft).map(([department, fields]) =>
        [department, fields.filter((field) => departmentExpenseLimit(department).includes(field))]));
      if ((await saveConfig({ departmentResources: bounded })) === false)
        throw new Error("部门默认权限未保存，请重试。");
      context?.notify?.(
        `${selectedDepartment.replace("|", " / ")} 的历史费用默认权限已保存。`,
      );
    } catch (failure) {
      setDepartmentError(failure.message || "部门默认权限保存失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Card className="panel v19-history-permissions gap-0 py-0">
        <div className="panel-header">
          <div>
            <h2>历史费用明细权限</h2>
            <p className="v19-permission-description">
              历史投资总额、Yield、历史资源占比始终可见。MKT 可看 MRD、SP&A；ICE 可看 ICE Rebate、SP&A；Capex 可看 Capex。所有角色均受本人所属部门限制，用户配置只能进一步收窄。
            </p>
          </div>
          <Button
            type="button"
            disabled={busy || readOnly}
            onClick={savePermissions}
          >
            {busy ? "保存中…" : "保存权限"}
          </Button>
        </div>
        <h3>按用户收窄权限</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>用户</TableHead>
              <TableHead>权限来源</TableHead>
              {resources.map((resource) => (
                <TableHead key={resource}>{resource}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => {
              const fields = Object.hasOwn(userDraft, user.id)
                ? userDraft[user.id]
                : user.history_resources;
              const disabled = busy || readOnly || !hasValidAffiliation(user);
              const allowed = departmentExpenseFields(mapping, user.affiliation_sector, user.affiliation_department);
              const effective = fields == null ? allowed : allowed.filter((field) => fields.includes(field));
              return (
                <TableRow key={user.id}>
                  <TableCell>
                    {user.display_name}
                    <small className="v19-user-permission-source">
                      {!hasValidAffiliation(user) ? "请先维护所属部门" : ""}
                    </small>
                  </TableCell>
                  <TableCell>
                    <NativeSelect
                      aria-label={`${user.display_name} 权限来源`}
                      disabled={disabled}
                      value={fields == null ? "inherit" : "custom"}
                      onChange={(event) =>
                        setUserDraft((current) => ({
                          ...current,
                          [user.id]:
                            event.target.value === "inherit" ? null : [],
                        }))
                      }
                    >
                      <NativeSelectOption value="inherit">
                        沿用所属部门
                      </NativeSelectOption>
                      <NativeSelectOption value="custom">
                        收窄可见费用列
                      </NativeSelectOption>
                    </NativeSelect>
                  </TableCell>
                  {resources.map((resource) => (
                    <TableCell key={resource}>
                      <Checkbox
                        aria-label={`${user.display_name} 可查看 ${resource}`}
                        disabled={disabled || fields == null || !allowed.includes(resource)}
                        checked={effective.includes(resource)}
                        onCheckedChange={(checked) =>
                          setUserDraft((current) => ({
                            ...current,
                            [user.id]:
                              checked === true
                                ? [...effective, resource]
                                : effective.filter(
                                    (item) => item !== resource,
                                  ),
                          }))
                        }
                      />
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
            {!users.length && (
              <TableRow>
                <TableCell colSpan={6}>
                  {usersLoading
                    ? "正在加载用户权限…"
                    : usersError || "暂无用户"}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {(error || usersError) && (
          <Alert
            variant="destructive"
            role="alert"
            className="v19-permission-error"
          >
            <AlertDescription>{error || usersError}</AlertDescription>
          </Alert>
        )}
      </Card>
      <Card className="panel v19-department-permissions gap-0 py-0">
        <div className="panel-header">
          <div>
            <h2>所属部门的历史费用默认权限</h2>
            <p className="v19-permission-description">
              默认显示该部门对应大类，可在此进一步收窄。用户配置不能突破部门范围；缺少有效所属部门时不提供费用明细。
            </p>
          </div>
        </div>
        <div className="v19-department-permission-controls">
          <Label>
            所属部门
            <NativeSelect
              aria-label="历史费用默认权限所属部门"
              value={selectedDepartment}
              disabled={busy}
              onChange={(event) => setSelected(event.target.value)}
            >
              {names.map((name) => (
                <NativeSelectOption key={name} value={name}>
                  {name.replace("|", " / ")}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Label>
          <Label>
            默认策略
            <NativeSelect
              aria-label="部门历史费用默认策略"
              value={customDepartment ? "custom" : "inherit"}
              disabled={busy || readOnly || !selectedDepartment}
              onChange={(event) =>
                setDraft((current) => {
                  const next = { ...current };
                  if (event.target.value === "custom")
                    next[selectedDepartment] = [];
                  else delete next[selectedDepartment];
                  return next;
                })
              }
            >
              <NativeSelectOption value="inherit">
                沿用所属部门对应大类
              </NativeSelectOption>
              <NativeSelectOption value="custom">
                收窄本部门费用列
              </NativeSelectOption>
            </NativeSelect>
          </Label>
          {resources.map((resource) => (
            <Label key={resource} className="v19-permission-check">
              <Checkbox
                aria-label={`${selectedDepartment} 可查看 ${resource}`}
                disabled={busy || readOnly || !customDepartment || !departmentExpenseLimit(selectedDepartment).includes(resource)}
                checked={departmentExpenseLimit(selectedDepartment).includes(resource) && (!customDepartment || (draft[selectedDepartment] || []).includes(resource))}
                onCheckedChange={(checked) =>
                  toggle(
                    setDraft,
                    selectedDepartment,
                    resource,
                    checked === true,
                  )
                }
              />
              {resource}
            </Label>
          ))}
          <Button
            type="button"
            disabled={busy || readOnly || !selectedDepartment}
            onClick={saveDepartment}
          >
            保存部门默认
          </Button>
        </div>
        <p className="small-text">
          所属部门只关联费用列权限，不改变业务数据范围。SP&A
          为历史合计，暂不拆部门。
        </p>
        {departmentError && (
          <Alert
            variant="destructive"
            role="alert"
            className="v19-permission-error"
          >
            <AlertDescription>{departmentError}</AlertDescription>
          </Alert>
        )}
      </Card>
    </>
  );
}
