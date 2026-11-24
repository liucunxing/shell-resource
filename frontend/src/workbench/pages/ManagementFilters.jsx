import { FilterMenu } from "./FilterMenu";
import E from "../domain/engine.js";
import {
  filterManagementItems,
  managementFilterDimensions,
  managementFilterValue,
} from "../domain/management-filters";
import { orderedResourceTypes } from "./V19PortfolioVisuals.jsx";

export function resolveManagementFilters(items, selections = {}) {
  let filters = selections;
  let scopedItems = items;
  const fields = [];
  for (const [key, label] of managementFilterDimensions) {
    const options = new Map();
    const source = key === "sector" || key === "department" ? items : scopedItems;
    const resourceDepartments = key === "resourceType"
      ? (filters.department || []).map((department) => department.trim().toUpperCase())
      : [];
    for (const item of source) {
      const value = managementFilterValue(item, key);
      if (!value || options.has(value)) continue;
      if (
        resourceDepartments.length &&
        Object.hasOwn(E.RESOURCE_DEPARTMENT, value) &&
        !resourceDepartments.includes(E.RESOURCE_DEPARTMENT[value])
      ) continue;
      options.set(value, key === "initiative"
        ? { value, label: item.name, scope: [item.sector, item.department].filter(Boolean).join(" / ") }
        : { value, label: value });
    }
    fields.push({
      key,
      label,
      options: key === "resourceType"
        ? orderedResourceTypes([...options.keys()]).map((value) => options.get(value))
        : [...options.values()].sort((a, b) => a.label.localeCompare(b.label, "zh-CN")),
    });
    const selected = filters[key];
    if (selected?.length) {
      const available = selected.filter((value) => options.has(value));
      if (available.length !== selected.length) filters = { ...filters, [key]: available };
      scopedItems = filterManagementItems(scopedItems, { [key]: available });
    }
  }
  return { fields, filters, scopedItems };
}


export function ManagementFilters({ fields, filters, setFilters }) {
  return (
    <div className="v19-executive-filters" role="group" aria-label="管理层筛选">
      {fields.map(({ key, label, options }) => (
        <FilterMenu
          key={key}
          label={label}
          options={options}
          selected={filters[key]}
          searchable={key === "initiative"}
          onChange={(values) => setFilters((current) => ({ ...current, [key]: values }))}
        />
      ))}
    </div>
  );
}
