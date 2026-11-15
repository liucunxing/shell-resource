const DEPARTMENT_LIMITS: Record<string, string[]> = {
  MKT: ["MRD", "SP&A"], ICE: ["ICE Rebate", "SP&A"], CAPEX: ["Capex"],
};

export function departmentExpenseLimit(department?: string | null): string[] {
  const key = String(department || "").split("|").at(-1)?.toUpperCase() || "";
  return [...(DEPARTMENT_LIMITS[key] || [])];
}

export function departmentExpenseFields(
  mapping: Record<string, string[]>, sector: string, department: string,
): string[] {
  const limit = departmentExpenseLimit(department);
  const configured = mapping[`${sector}|${department}`] ?? mapping[department];
  return Array.isArray(configured) ? limit.filter((field) => configured.includes(field)) : limit;
}
