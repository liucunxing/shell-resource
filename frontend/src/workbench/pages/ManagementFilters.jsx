import { FilterMenu } from "./FilterMenu";
import { managementFilterDimensions, managementFilterValue } from "../domain/management-filters";
import { orderedResourceTypes } from "./V19PortfolioVisuals.jsx";

export function managementFilterFields(items) {
  return managementFilterDimensions.map(([key, label]) => {
    const options = new Map();
    for (const item of items) {
      const value = managementFilterValue(item, key);
      if (!value || options.has(value)) continue;
      options.set(value, key === "initiative"
        ? { value, label: item.name, scope: [item.sector, item.department].filter(Boolean).join(" / ") }
        : { value, label: value });
    }
    return {
      key,
      label,
      options: key === "resourceType"
        ? orderedResourceTypes([...options.keys()]).map((value) => options.get(value))
        : [...options.values()].sort((a, b) => a.label.localeCompare(b.label, "zh-CN")),
    };
  });
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
