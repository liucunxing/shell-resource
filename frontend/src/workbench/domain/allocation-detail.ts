/** V17 column order confirmed for V20; authorization changes only the expense leaves. */
export const EXPENSE_COLUMN_ORDER = ["ICE Rebate", "MRD", "SP&A", "Capex"];
export type DetailColumnGroup = {
  key: string;
  title: string;
  columns: [string, string][];
};

type AwardedInitiative = {
  id: string;
  name: string;
  ownerId: string;
  sector: string;
  enabled?: boolean;
  allocationVisible?: boolean;
  rows?: { dealerId: string; amount: number }[];
};

export function awardedInitiativesByDealer(
  current: AwardedInitiative,
  initiatives: AwardedInitiative[],
): Map<string, AwardedInitiative[]> {
  const byDealer = new Map<string, AwardedInitiative[]>();
  for (const item of [current, ...initiatives.filter(({ id }) => id !== current.id)]) {
    if (
      item.enabled === false || item.allocationVisible === false ||
      item.ownerId !== current.ownerId || item.sector !== current.sector
    ) continue;
    const awardedIds = new Set(
      (item.rows ?? []).filter((row) => row.amount > 0).map((row) => String(row.dealerId)),
    );
    for (const id of awardedIds) {
      const awards = byDealer.get(id) ?? [];
      awards.push(item);
      byDealer.set(id, awards);
    }
  }
  return byDealer;
}

export function allocationColumnGroups(
  expenses: string[],
  editable = false,
  splitDealerIdentity = false,
  showRsm = true,
): DetailColumnGroup[] {
  return [
    {
      key: "plan",
      title: "当前规划",
      columns: [
        ...(splitDealerIdentity
          ? [["code", "经销商编码"], ["name", "经销商名称"], ["status", "状态"]] as [string, string][]
          : [["name", "经销商 / 编码"]] as [string, string][]),
        ["amount", editable ? "分配金额（元）" : "累计投资金额（元）"],
      ],
    },
    {
      key: "organization",
      title: "组织属性",
      columns: [
        ["sd", "SD"],
        ...(showRsm ? [["rsm", "RSM"]] as [string, string][] : []),
      ],
    },
    {
      key: "share",
      title: "分布占比 · 差值",
      columns: [
        ["amountShare", "投资金额占比（%）"],
        ["volShare", "Delivery Vol占比（%）"],
        ["c3Share", "C3占比（%）"],
        ["gapVol", "投资金额−Delivery Vol（pp）"],
        ["gapC3", "投资金额−C3（pp）"],
      ],
    },
    {
      key: "contract",
      title: "① 经销商 target",
      columns: [
        ["contract", "经销商 target（KL）"],
        ["contractShare", "target 占比（%）"],
      ],
    },
    {
      key: "actual",
      title: "② Actual信息",
      columns: [
        ["vol", "Delivery Vol（KL）"],
        ["c3", "Actual C3（K$）"],
        ["phasing", "Vol Phasing（%）"],
      ],
    },
    {
      key: "investment",
      title: "③ 历史投资数据",
      columns: [
        ["investment", "历史投资总额（K$）"],
        ...EXPENSE_COLUMN_ORDER.filter((type) => expenses.includes(type)).map(
          (type) =>
            [`expense:${type}`, `${type}（K$）`] as [string, string],
        ),
        ["yield", "Yield（C3÷投资）"],
        ["investmentShare", "历史投资占比（%）"],
      ],
    },
    {
      key: "support",
      title: "支持与说明",
      columns: [
        ["support", "获配项目数"],
        ["note", "调整说明"],
      ],
    },
  ];
}

/** Prefer business terms and units as wrap points in narrow, sortable columns. */
export function compactColumnLabel(title: string): string {
  if (title.includes(" · ")) return title.replace(" · ", "\n");
  if (title.includes("−")) return title.replace("−", "\n−");
  if (title.length >= 9) return title.replace("（", "\n（");
  return title;
}
