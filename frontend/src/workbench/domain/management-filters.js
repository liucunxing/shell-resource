export const managementFilterDimensions = [
  ["sector", "业务线"],
  ["department", "部门"],
  ["resourceType", "资源大类"],
  ["initiative", "Initiative"],
];

export function managementFilterValue(item, key) {
  return key === "initiative" ? String(item.initiativeKey || item.id) : item[key];
}

export function retainAvailableManagementFilters(filters, fields) {
  const available = {};
  let removed = false;
  for (const { key, options } of fields) {
    if (!filters[key]) continue;
    const values = new Set(options.map((option) => option.value));
    available[key] = filters[key].filter((value) => values.has(value));
    removed ||= available[key].length !== filters[key].length;
  }
  return removed ? available : filters;
}

export function filterManagementItems(items, filters) {
  const selections = Object.entries(filters || {}).filter(([, values]) => values.length);
  if (!selections.length) return items;
  return items.filter((item) =>
    selections.every(([key, values]) => values.includes(managementFilterValue(item, key))),
  );
}
