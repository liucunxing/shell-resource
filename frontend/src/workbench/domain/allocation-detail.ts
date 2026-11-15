/** V17 column order confirmed for V20; authorization changes only the expense leaves. */
export const EXPENSE_COLUMN_ORDER = ["ICE Rebate", "MRD", "SP&A", "Capex"];
export type DetailColumnGroup = {
  key: string;
  title: string;
  columns: [string, string][];
};
export function allocationColumnGroups(
  expenses: string[],
  editable = false,
): DetailColumnGroup[] {
  return [
    {
      key: "plan",
      title: "当前规划",
      columns: [
        ["name", "经销商 / 编码"],
        ["amount", editable ? "分配金额（元）" : "累计投资金额（万元）"],
      ],
    },
    {
      key: "organization",
      title: "组织属性",
      columns: [
        ["sd", "SD"],
        ["rsm", "RSM"],
      ],
    },
    {
      key: "share",
      title: "分布占比 · 差值",
      columns: [
        ["amountShare", "投资金额占比"],
        ["volShare", "Delivery Vol占比"],
        ["c3Share", "C3占比"],
        ["gapVol", "投资金额−Delivery Vol"],
        ["gapC3", "投资金额−C3"],
      ],
    },
    {
      key: "contract",
      title: "① 合同信息",
      columns: [
        ["contract", "合同量（KL）"],
        ["contractShare", "合同量占比"],
      ],
    },
    {
      key: "actual",
      title: "② Actual信息",
      columns: [
        ["vol", "Delivery Vol（KL）"],
        ["c3", "Actual C3（千美元）"],
        ["phasing", "Phasing"],
      ],
    },
    {
      key: "investment",
      title: "③ 历史投资数据",
      columns: [
        ["investment", "历史投资总额（千美元）"],
        ...EXPENSE_COLUMN_ORDER.filter((type) => expenses.includes(type)).map(
          (type) =>
            [`expense:${type}`, `${type}（千美元）`] as [string, string],
        ),
        ["yield", "Yield（C3÷投资）"],
        ["investmentShare", "历史投资占比"],
      ],
    },
    {
      key: "support",
      title: "支持与说明",
      columns: [
        ["support", editable ? "本人其他 Initiative" : "获配项目数"],
        ["note", "调整说明"],
      ],
    },
  ];
}
