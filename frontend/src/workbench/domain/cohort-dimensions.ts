export const COHORT_DIMENSIONS = [
  { key: "resourceType", label: "资源大类" },
  { key: "initiative", label: "Initiative" },
  { key: "sector", label: "Sector" },
  { key: "department", label: "部门" },
] as const;

export type CohortDimension = (typeof COHORT_DIMENSIONS)[number]["key"];
export type CohortFilteredDimension = Exclude<CohortDimension, "initiative">;
type Source = { id: string; name: string; amount: number; key?: string };
type Item = {
  id: string;
  name: string;
  initiativeKey?: string;
  resourceType?: string;
  sector?: string;
  department?: string;
};
export type CohortContribution = {
  id: string;
  name: string;
  amount: number;
  initiativeKey?: string;
};

export function defaultCohortDimension(
  filtered: readonly CohortFilteredDimension[] = [],
): CohortDimension {
  return filtered.length ? "initiative" : "resourceType";
}

/** Regroup allocated sources, never regroup or duplicate dealer identities. */
export function cohortContributionParts(
  sources: Source[],
  items: Item[],
  dimension: CohortDimension,
): CohortContribution[] {
  const byId = new Map(items.map((item) => [String(item.id), item]));
  const groups = new Map<string, CohortContribution>();
  for (const source of sources) {
    const item = byId.get(String(source.id));
    if (!item) continue;
    const id =
      dimension === "initiative"
        ? String(item.id)
        : item[dimension] || "未配置";
    const existing = groups.get(id) || {
      id,
      name: dimension === "initiative" ? item.name : id,
      amount: 0,
      initiativeKey:
        dimension === "initiative"
          ? item.initiativeKey || source.key || String(item.id)
          : undefined,
    };
    existing.amount += source.amount;
    groups.set(id, existing);
  }
  return [...groups.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function cohortSectorColor(sector: string) {
  // V20 DEF_ORG order, kept fixed so filtering never changes a Sector's color.
  const known: Record<string, string> = {
    PCMO: "#EB8705",
    B2B: "#003C88",
    CRTO: "#008443",
    OEM: "#641964",
  };
  return known[sector] || "#EB8705";
}
