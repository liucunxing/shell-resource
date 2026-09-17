import {
  DEPARTMENTS,
  RESOURCES,
  SECTORS,
  type Budget,
  type Department,
  type WorkspaceState,
} from "./types";
export type Dataset =
  "budgets" | "history" | "forecast" | "applicable" | "adjust" | "tracking";
type Options = {
  department?: Department;
  initiativeId?: string;
  template?: boolean;
};
type Row = Record<string, unknown>;
export const specs = {
  budgets: {
    sheet: "预算内容",
    headers: [
      "Sector",
      "Department",
      "Resource Type",
      "Initiative",
      "PlanBudget",
    ],
  },
  history: {
    sheet: "历史表现",
    headers: [
      "Year",
      "Quarter",
      "Sector",
      "Distributor",
      "Resource Type",
      "Vol",
      "C3",
      "Resource",
    ],
  },
  forecast: {
    sheet: "明年预计",
    headers: ["Year", "Sector", "Distributor", "ExpectedVol", "ExpectedC3"],
  },
  applicable: {
    sheet: "适用范围",
    headers: ["Sector", "Department", "Initiative", "Distributor", "Source"],
  },
  adjust: {
    sheet: "部门调整",
    headers: [
      "Sector",
      "Department",
      "Resource Type",
      "Initiative",
      "Distributor",
      "Basis",
      "InitialAmount",
      "PlanAmount",
      "UnallocatedAmount",
      "Explanation",
    ],
  },
  tracking: {
    sheet: "2027 Tracking",
    headers: [
      "Quarter",
      "Sector",
      "Distributor",
      "Department",
      "Initiative",
      "ActualSpendYTD",
      "ActualC3",
      "ForecastSpend",
      "OverrideReason",
    ],
  },
};
const str = (v: unknown) => String(v ?? "").trim();
const id = () => crypto.randomUUID();
const number = (v: unknown) =>
  typeof v === "number"
    ? v
    : typeof v === "string" && v.trim() !== ""
      ? Number(v)
      : NaN;
const budgetFields = (b: Budget) => ({
  Sector: b.sector,
  Department: b.department,
  "Resource Type": b.resource,
  Initiative: b.name,
});
const matches = (b: Budget, r: Row) =>
  b.sector === str(r.Sector) &&
  b.department === str(r.Department) &&
  b.name === str(r.Initiative);
function baseline(s: WorkspaceState, t: Dataset) {
  return t === "tracking" ? (s.versions[0]?.budgets ?? []) : s.budgets;
}
function findBudget(s: WorkspaceState, t: Dataset, r: Row) {
  return baseline(s, t).find((b) => matches(b, r));
}
export function datasetRows(
  s: WorkspaceState,
  t: Dataset,
  o: Options = {},
): Row[] {
  if (t === "budgets")
    return s.budgets.map((b) => ({ ...budgetFields(b), PlanBudget: b.amount }));
  if (t === "history")
    return s.history.map((r) => ({
      Year: r.year,
      Quarter: r.quarter,
      Sector: r.sector,
      Distributor: r.distributor,
      "Resource Type": r.resource,
      Vol: r.vol,
      C3: r.c3,
      Resource: r.spend,
    }));
  if (t === "forecast")
    return s.forecast.map((r) => ({
      Year: r.year,
      Sector: r.sector,
      Distributor: r.distributor,
      ExpectedVol: r.vol,
      ExpectedC3: r.c3,
    }));
  if (t === "applicable")
    return s.applicable
      .filter((r) => r.initiativeId === o.initiativeId && r.enabled)
      .map((r) => ({
        ...budgetFields(s.budgets.find((b) => b.id === r.initiativeId)!),
        Distributor: r.distributor,
        Source: r.source,
      }));
  if (t === "adjust")
    return s.allocations
      .filter(
        (r) =>
          s.budgets.find((b) => b.id === r.initiativeId)?.department ===
          o.department,
      )
      .map((r) => {
        const b = s.budgets.find((b) => b.id === r.initiativeId)!;
        return {
          ...budgetFields(b),
          Distributor: r.distributor,
          Basis: r.basisLabel,
          InitialAmount: r.initialAmount,
          PlanAmount: r.amount,
          UnallocatedAmount: b.pool,
          Explanation: r.explanation,
        };
      });
  return s.tracking
    .map((r) => {
      const b = s.versions[0]?.budgets.find((b) => b.id === r.initiativeId);
      return b
        ? {
            Quarter: r.quarter,
            ...budgetFields(b),
            Distributor: r.distributor,
            ActualSpendYTD: r.actualSpendYtd,
            ActualC3: r.actualC3,
            ForecastSpend: r.forecastSpend,
            OverrideReason: r.reason,
          }
        : null;
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
}
export async function exportDataset(
  s: WorkspaceState,
  t: Dataset,
  o: Options = {},
): Promise<void> {
  if (t === "adjust" && !o.department) throw new Error("请选择部门");
  if (t === "applicable" && !s.budgets.some((b) => b.id === o.initiativeId))
    throw new Error("请选择有效项目");
  const { Workbook } = await import("exceljs");
  const wb = new Workbook();
  const ws = wb.addWorksheet(specs[t].sheet);
  ws.addRow(specs[t].headers);
  if (!o.template)
    datasetRows(s, t, o).forEach((r) =>
      ws.addRow(specs[t].headers.map((h) => r[h] ?? "")),
    );
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.columns.forEach((c) => {
    c.width = 22;
  });
  const buffer = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(
    new Blob([buffer as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `${specs[t].sheet}${o.template ? "_模板" : ""}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function validateRows(
  rows: Row[],
  t: Dataset,
  s: WorkspaceState,
  o: Options = {},
): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  if (!rows.length) return ["文件没有数据行，请填写模板后重新导入"];
  if (t === "adjust" && !o.department) return ["请先选择部门，不能跨部门导入"];
  if (t === "applicable" && !s.budgets.some((b) => b.id === o.initiativeId))
    return ["请先选择有效项目"];
  if (t === "tracking" && !s.versions.length)
    return ["尚无正式版本，无法导入 Tracking"];
  rows.forEach((r, index) => {
    const row = Number(r.__row) || index + 2;
    const err = (v: string) => errors.push(`第${row}行：${v}`);
    const required = (k: string) => {
      if (!str(r[k])) err(`缺少 ${k}`);
    };
    const numeric = (k: string, optional = false) => {
      if (optional && !str(r[k])) return;
      const n = number(r[k]);
      if (!Number.isFinite(n) || n < 0) err(`${k} 必须是非负有效数字`);
      else if (
        [
          "PlanBudget",
          "PlanAmount",
          "InitialAmount",
          "UnallocatedAmount",
          "ActualSpendYTD",
          "ForecastSpend",
        ].includes(k) &&
        !Number.isSafeInteger(n)
      )
        err(`${k} 必须为非负整数元`);
    };
    required("Sector");
    if (!(SECTORS as readonly string[]).includes(str(r.Sector)))
      err("Sector 不合法");
    if (t !== "history" && t !== "forecast") {
      required("Department");
      if (!(DEPARTMENTS as readonly string[]).includes(str(r.Department)))
        err("Department 不合法");
      required("Initiative");
    }
    if (t !== "budgets") required("Distributor");
    if (
      ["budgets", "history", "adjust"].includes(t) &&
      !(RESOURCES as readonly string[]).includes(str(r["Resource Type"]))
    )
      err("Resource Type 不合法");
    if (t === "budgets") numeric("PlanBudget");
    if (t === "history" || t === "forecast") {
      const y = number(r.Year);
      if (!Number.isInteger(y) || y < 2000 || y > 2100)
        err("Year 必须为 2000–2100 年");
    }
    if (t === "history") {
      if (!["Q1", "Q2", "Q3", "Q4", "FY"].includes(str(r.Quarter)))
        err("Quarter 必须为 Q1–Q4 或 FY");
      ["Vol", "C3", "Resource"].forEach((k) => numeric(k));
    }
    if (t === "forecast")
      ["ExpectedVol", "ExpectedC3"].forEach((k) => numeric(k));
    if (["applicable", "adjust", "tracking"].includes(t)) {
      const b = findBudget(s, t, r);
      if (!b) err("Sector / Department / Initiative 未匹配到项目");
      if (t === "applicable" && b?.id !== o.initiativeId)
        err("适用范围包含其他项目，整批拒绝");
      if (t === "adjust") {
        if (str(r.Department) !== o.department) err("包含其他部门，整批拒绝");
        if (b && str(r["Resource Type"]) !== b.resource)
          err("Resource Type 与项目不一致");
        const a = s.allocations.find(
          (x) =>
            x.initiativeId === b?.id && x.distributor === str(r.Distributor),
        );
        if (!a) err("未找到原始分配记录");
        ["InitialAmount", "PlanAmount", "UnallocatedAmount"].forEach((k) =>
          numeric(k),
        );
        if (a && number(r.InitialAmount) !== a.initialAmount)
          err("InitialAmount 不能修改");
        if (a?.locked && number(r.PlanAmount) !== a.amount)
          err("锁定金额不能通过 Excel 修改");
        if (a && number(r.PlanAmount) !== a.amount && !str(r.Explanation))
          err("调整金额须填写 Explanation");
      }
      if (t === "tracking") {
        if (!["Q1", "Q2", "Q3", "Q4"].includes(str(r.Quarter)))
          err("Quarter 必须为 Q1–Q4");
        numeric("ActualSpendYTD");
        numeric("ActualC3", true);
        numeric("ForecastSpend", true);
        if (
          !s.versions[0]?.allocations.some(
            (a) =>
              a.initiativeId === b?.id && a.distributor === str(r.Distributor),
          )
        )
          err("Distributor 不在正式版本分配中");
      }
    }
    const keys =
      t === "history"
        ? ["Year", "Quarter", "Sector", "Distributor", "Resource Type"]
        : t === "forecast"
          ? ["Year", "Sector", "Distributor"]
          : t === "budgets"
            ? ["Sector", "Department", "Initiative"]
            : t === "tracking"
              ? ["Quarter", "Sector", "Department", "Initiative", "Distributor"]
              : ["Sector", "Department", "Initiative", "Distributor"];
    const key = keys.map((k) => str(r[k])).join("|");
    if (seen.has(key)) err("重复记录");
    seen.add(key);
  });
  if (t === "adjust" && !errors.length) {
    const current = datasetRows(s, t, o);
    if (rows.length !== current.length)
      errors.push("调整表必须包含本部门全部分配记录，不允许遗漏");
    s.budgets
      .filter((b) => b.department === o.department)
      .forEach((b) => {
        const group = rows.filter((r) => matches(b, r));
        if (!group.length) return;
        const pool = number(group[0].UnallocatedAmount);
        if (group.some((r) => number(r.UnallocatedAmount) !== pool))
          errors.push(`${b.name}：各行 UnallocatedAmount 须一致`);
        if (
          Math.abs(
            group.reduce((sum, r) => sum + number(r.PlanAmount), 0) +
              pool -
              b.amount,
          ) > 0.005
        )
          errors.push(`${b.name}：分配金额 + 待分配池必须等于项目预算`);
      });
  }
  return errors;
}
export async function parseDataset(
  file: File,
  t: Dataset,
  s: WorkspaceState,
  o: Options = {},
): Promise<{ rows: Row[]; errors: string[]; count: number }> {
  if (!/\.xlsx$/i.test(file.name))
    return {
      rows: [],
      errors: ["仅支持 .xlsx；.xls 暂不支持，请先另存为 .xlsx"],
      count: 0,
    };
  if (file.size > 10 * 1024 * 1024)
    return { rows: [], errors: ["文件超过 10 MB，请拆分后导入"], count: 0 };
  try {
    const { Workbook } = await import("exceljs");
    const wb = new Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.getWorksheet(specs[t].sheet) ?? wb.worksheets[0];
    if (!ws) throw new Error("没有工作表");
    const headers: string[] = [];
    ws.getRow(1).eachCell((cell, col) => {
      headers[col] = str(cell.text);
    });
    const missing = specs[t].headers.filter((h) => !headers.includes(h));
    if (missing.length)
      return {
        rows: [],
        errors: [`缺少表头：${missing.join("、")}`],
        count: 0,
      };
    const rows: Row[] = [];
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const r: Row = { __row: n };
      let populated = false;
      headers.forEach((h, i) => {
        const c = row.getCell(i);
        const v = c.value;
        if (v !== null && v !== "") populated = true;
        r[h] = typeof v === "object" && v !== null ? c.text : (v ?? "");
      });
      if (populated) rows.push(r);
    });
    return { rows, errors: validateRows(rows, t, s, o), count: rows.length };
  } catch (e) {
    return {
      rows: [],
      errors: [
        `无法读取 Excel：${e instanceof Error ? e.message : "文件损坏"}`,
      ],
      count: 0,
    };
  }
}
export function invalidate(s: WorkspaceState, ids: string[]): WorkspaceState {
  const affected = new Set(ids);
  const departments = new Set(
    s.budgets.filter((b) => affected.has(b.id)).map((b) => b.department),
  );
  return {
    ...s,
    budgets: s.budgets.map((b) =>
      affected.has(b.id)
        ? { ...b, completed: false, pool: b.amount, poolReason: "" }
        : b,
    ),
    allocations: s.allocations.filter((a) => !affected.has(a.initiativeId)),
    confirmed: Object.fromEntries(
      Object.entries(s.confirmed).filter(
        ([d]) => !departments.has(d as Department),
      ),
    ),
  };
}
export function applyDataset(
  s: WorkspaceState,
  t: Dataset,
  rows: Row[],
  o: Options = {},
): WorkspaceState {
  const errors = validateRows(rows, t, s, o);
  if (errors.length) throw new Error(errors.join("\n"));
  let next: WorkspaceState = { ...s, dataMode: "user" };
  if (t === "budgets") {
    next = invalidate(
      next,
      s.budgets.map((b) => b.id),
    );
    next.budgets = rows.map((r) => {
      const old = s.budgets.find((b) => matches(b, r));
      return {
        id: old?.id ?? id(),
        sector: str(r.Sector),
        department: str(r.Department),
        resource: str(r["Resource Type"]),
        name: str(r.Initiative),
        amount: number(r.PlanBudget),
        pool: number(r.PlanBudget),
        poolReason: "",
        basis: old?.basis ?? "Vol",
        period: old?.period ?? "2026 FY",
        reservePercent: old?.reservePercent ?? 0,
        completed: false,
      } as Budget;
    });
    next.applicable = s.applicable.filter((a) =>
      next.budgets.some((b) => b.id === a.initiativeId),
    );
  } else if (t === "history") {
    next = invalidate(
      next,
      s.budgets.map((b) => b.id),
    );
    next.history = rows.map((r) => ({
      id: id(),
      year: number(r.Year),
      quarter: str(r.Quarter) as WorkspaceState["history"][number]["quarter"],
      sector: str(r.Sector) as Budget["sector"],
      distributor: str(r.Distributor),
      resource: str(r["Resource Type"]) as Budget["resource"],
      vol: number(r.Vol),
      c3: number(r.C3),
      spend: number(r.Resource),
    }));
  } else if (t === "forecast") {
    next = invalidate(
      next,
      s.budgets.map((b) => b.id),
    );
    next.forecast = rows.map((r) => ({
      id: id(),
      year: number(r.Year),
      sector: str(r.Sector) as Budget["sector"],
      distributor: str(r.Distributor),
      vol: number(r.ExpectedVol),
      c3: number(r.ExpectedC3),
    }));
  } else if (t === "applicable") {
    next = invalidate(next, [o.initiativeId!]);
    next.applicable = [
      ...s.applicable.filter((a) => a.initiativeId !== o.initiativeId),
      ...rows.map((r) => ({
        id: id(),
        initiativeId: o.initiativeId!,
        distributor: str(r.Distributor),
        source: str(r.Source) || "Excel",
        enabled: true,
      })),
    ];
  } else if (t === "adjust") {
    next.allocations = s.allocations.map((a) => {
      const r = rows.find(
        (r) =>
          findBudget(s, t, r)?.id === a.initiativeId &&
          str(r.Distributor) === a.distributor,
      );
      return r
        ? {
            ...a,
            amount: number(r.PlanAmount),
            explanation: str(r.Explanation),
          }
        : a;
    });
    next.budgets = s.budgets.map((b) => {
      const r = rows.find((r) => matches(b, r));
      return r
        ? { ...b, pool: number(r.UnallocatedAmount), completed: false }
        : b;
    });
    next.confirmed = { ...s.confirmed, [o.department!]: false };
  } else
    next.tracking = rows.map((r) => ({
      id: id(),
      initiativeId: findBudget(s, t, r)!.id,
      distributor: str(r.Distributor),
      quarter: str(r.Quarter) as WorkspaceState["tracking"][number]["quarter"],
      actualSpendYtd: number(r.ActualSpendYTD),
      actualC3: str(r.ActualC3) ? number(r.ActualC3) : null,
      forecastSpend: str(r.ForecastSpend) ? number(r.ForecastSpend) : null,
      reason: str(r.OverrideReason),
    }));
  return next;
}
