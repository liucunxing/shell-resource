import E from "../domain/engine.js";

const resources = ["MRD", "SP&A", "ICE Rebate", "Capex"];

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
          ["owner", "lead"].includes(user.role) &&
          E.hasDepartment(user, value.department),
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
      <label className="form-field">
        Initiative 名称
        <input
          maxLength={255}
          value={value.name}
          onChange={(event) => set("name", event.target.value)}
        />
      </label>
      <label className="form-field">
        Sector
        <input
          maxLength={32}
          value={value.sector}
          onChange={(event) => set("sector", event.target.value)}
        />
      </label>
      <label className="form-field">
        资源类型
        <select
          value={value.resourceType}
          onChange={(event) => set("resourceType", event.target.value)}
        >
          {resources.map((resource) => (
            <option key={resource}>{resource}</option>
          ))}
        </select>
      </label>
      <label className="form-field">
        部门
        <select
          value={value.department}
          onChange={(event) =>
            onChange({ ...value, department: event.target.value, ownerId: "" })
          }
        >
          {departments.map((department) => (
            <option key={department}>{department}</option>
          ))}
        </select>
      </label>
      <label className="form-field">
        Owner 邮箱
        <select
          value={apiMode ? value.ownerId.toLowerCase() : value.ownerId}
          onChange={(event) => set("ownerId", event.target.value)}
        >
          <option value="">请选择部门内 Owner</option>
          {owners.map((owner) => (
            <option
              key={owner.email}
              value={apiMode ? owner.email.toLowerCase() : owner.email}
            >
              {owner.label || owner.display_name ? `${owner.label || owner.display_name}（${owner.email}）` : owner.email}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        预算金额
        <input
          type="number"
          min="0"
          step="0.01"
          value={value.budget}
          onChange={(event) => set("budget", event.target.value)}
        />
      </label>
    </fieldset>
  );
}
