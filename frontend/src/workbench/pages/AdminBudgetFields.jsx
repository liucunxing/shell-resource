import { Label } from "../../components/ui/label";
import { Input } from "../../components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "../../components/ui/native-select";
import E from "../domain/engine.js";

const resources = ["MRD", "SP&A", "ICE Rebate", "Capex"];
export const budgetSectors = ["PCMO", "CRTO", "B2B", "OEM"];

export function budgetForm(item) {
  return {
    name: item?.name || "",
    sector: item?.sector || "PCMO",
    resourceType: item?.resourceType || "MRD",
    department: item?.department || "MKT",
    ownerId: item?.ownerId || "",
    budget: item ? String(item.budget) : "",
  };
}

export function budgetPayload(form, apiMode) {
  if (!form.budget.trim()) throw Error("预算不能为空。");
  if (!budgetSectors.includes(form.sector))
    throw Error("业务线必须为 PCMO、CRTO、B2B 或 OEM。");
  return {
    name: form.name.trim(),
    sector: form.sector.trim(),
    department: form.department.trim(),
    resourceType:
      resources.find(
        (value) =>
          value.toLowerCase() === form.resourceType.trim().toLowerCase(),
      ) || form.resourceType.trim(),
    ownerId: apiMode ? form.ownerId.trim().toLowerCase() : form.ownerId.trim(),
    budget: Number(form.budget),
  };
}

export function AdminBudgetFields({
  value,
  onChange,
  users,
  apiMode,
  disabled,
}) {
  const set = (key, next) => onChange({ ...value, [key]: next });
  const owners = apiMode
    ? users.filter(
        (user) =>
          user.enabled !== false && E.hasDepartment(user, value.department),
      )
    : [1, 2].map((number) => ({ email: `${value.department}-${number}` }));
  const departments = [
    ...new Set([
      "MKT",
      "ICE",
      "CAPEX",
      ...users.flatMap((user) => E.departments(user)),
      value.department,
    ]),
  ].filter(Boolean);
  return (
    <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0 }}>
      <Label className="form-field">
        Initiative 名称
        <Input
          maxLength={255}
          value={value.name}
          onChange={(event) => set("name", event.target.value)}
        />
      </Label>
      <Label className="form-field">
        Sector
        <NativeSelect
          value={value.sector}
          onChange={(event) => set("sector", event.target.value)}
        >
          {budgetSectors.map((sector) => (
            <NativeSelectOption key={sector}>{sector}</NativeSelectOption>
          ))}
        </NativeSelect>
      </Label>
      <Label className="form-field">
        资源类型
        <NativeSelect
          value={value.resourceType}
          onChange={(event) => set("resourceType", event.target.value)}
        >
          {resources.map((resource) => (
            <NativeSelectOption key={resource}>{resource}</NativeSelectOption>
          ))}
        </NativeSelect>
      </Label>
      <Label className="form-field">
        部门
        <NativeSelect
          value={value.department}
          onChange={(event) =>
            onChange({ ...value, department: event.target.value, ownerId: "" })
          }
        >
          {departments.map((department) => (
            <NativeSelectOption key={department}>
              {department}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Label>
      <Label className="form-field">
        Owner 邮箱
        <NativeSelect
          value={apiMode ? value.ownerId.toLowerCase() : value.ownerId}
          onChange={(event) => set("ownerId", event.target.value)}
        >
          <NativeSelectOption value="">
            请选择部门内邮箱（含负责人）
          </NativeSelectOption>
          {owners.map((owner) => (
            <NativeSelectOption
              key={owner.email}
              value={apiMode ? owner.email.toLowerCase() : owner.email}
            >
              {owner.label || owner.display_name
                ? `${owner.label || owner.display_name}（${owner.email}）`
                : owner.email}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Label>
      <Label className="form-field">
        预算金额
        <Input
          type="number"
          min="0"
          step="0.01"
          value={value.budget}
          onChange={(event) => set("budget", event.target.value)}
        />
      </Label>
    </fieldset>
  );
}
