export const managementFilterDimensions = [
  ["sector", "业务线"],
  ["department", "部门"],
  ["resourceType", "资源大类"],
  ["initiative", "Initiative"],
];

export function managementFilterValue(item, key) {
  return key === "initiative" ? String(item.initiativeKey || item.id) : item[key];
}

export function filterManagementItems(items, filters) {
  const selections = Object.entries(filters || {}).filter(([, values]) => values.length);
  if (!selections.length) return items;
  return items.filter((item) =>
    selections.every(([key, values]) => values.includes(managementFilterValue(item, key))),
  );
}
