import engine from "./engine.js";
const excelLibrary = async () => (await import("exceljs")).default;
("use strict");
const SHEET = "预算与归属";
const HEADERS = [
  "Initiative名称",
  "Sector",
  "资源类型",
  "部门",
  "邮箱",
  "预算金额",
];
const RESOURCE_DEPARTMENT = {
  MRD: "MKT",
  "SP&A": "MKT",
  "ICE Rebate": "ICE",
  Capex: "CAPEX",
};
const tickets = new WeakMap();
const json = (value) => JSON.stringify(value);
const clone = (value) => JSON.parse(json(value));
function admin(identity) {
  if (!identity || identity.role !== "admin")
    throw Error("仅管理员可导入或导出管理员配置。");
}
function scope(state) {
  return json({
    final: state.final,
    budgetReasons: state.budgetReasons,
    departments: state.departments,
    initiatives: state.initiatives.map((i) => [
      i.id,
      i.name,
      i.sector,
      i.resourceType,
      i.department,
      i.ownerId,
      i.budget,
      i.revision,
    ]),
  });
}
function style(sheet, widths) {
  widths.forEach((width, n) => {
    sheet.getColumn(n + 1).width = width;
  });
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF536B90" },
  };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.properties.defaultRowHeight = 22;
}
async function exportWorkbook(state, identity) {
  admin(identity);
  const book = new (await excelLibrary()).Workbook();
  book.creator = "资源投资工作台 · 管理员配置";
  const info = book.addWorksheet("模板说明");
  info.addRows([
    ["字段", "内容"],
    [
      "部门与资源类型",
      "新增 Initiative 仅允许：MKT → MRD、SP&A；ICE → ICE Rebate；CAPEX → Capex。任一不匹配组合都会在预览中报错，且整份文件不能导入。",
    ],
    [
      "发布规则",
      "已发布 Initiative 仍可更新预算或 Owner；管理层保留最近一次发布快照，Owner 重新发布后才会更新该快照。",
    ],
    [
      "写入影响",
      "预览后确认才将新增与修改整批写入；任一行失败则整批不写入。预算/Owner 变化不移动经销商分配，也不改写既有发布快照。",
    ],
    [
      "适用范围",
      "此模板只维护预算与 Owner 归属，不包含分配明细、历史参考、人员权限或分析指南。",
    ],
  ]);
  style(info, [20, 110]);
  info.getColumn(2).alignment = { vertical: "middle", wrapText: true };
  for (let r = 2; r <= info.rowCount; r++) info.getRow(r).height = 40;
  const sheet = book.addWorksheet(SHEET);
  sheet.addRow(HEADERS);
  state.initiatives.forEach((i) =>
    sheet.addRow([
      i.name,
      i.sector,
      i.resourceType,
      i.department,
      i.ownerId,
      i.budget,
    ]),
  );
  style(sheet, [34, 18, 20, 18, 24, 22]);
  sheet.autoFilter = { from: "A1", to: "F1" };
  sheet.getColumn(6).numFmt = "#,##0.00";
  for (let r = 2; r <= sheet.rowCount; r++) {
    for (const c of [5, 6])
      sheet.getRow(r).getCell(c).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFEAF1FB" },
      };
    if (!identity.apiMode)
      sheet.getRow(r).getCell(5).dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: [
          '"' +
            sheet.getRow(r).getCell(4).value +
            "-1," +
            sheet.getRow(r).getCell(4).value +
            '-2"',
        ],
        showErrorMessage: true,
        error: "请选择同部门 Owner。",
      };
  }
  return book.xlsx.writeBuffer();
}
async function previewImport(buffer, state, identity, users = []) {
  const out = {
    errors: [],
    changes: [],
    creates: [],
    rows: 0,
    unchanged: 0,
    summary: { before: 0, after: 0 },
  };
  try {
    admin(identity);
  } catch (e) {
    out.errors.push(e.message);
    return out;
  }
  const initialScope = scope(state);
  const initial = clone(state);
  out.summary.before = engine.totals(initial.initiatives).budget;
  out.summary.after = out.summary.before;
  if (!buffer || (buffer.byteLength ?? buffer.length ?? 0) > 10 * 1024 * 1024) {
    out.errors.push("请选择 10 MB 以内的 .xlsx 配置模板。");
    return out;
  }
  const book = new (await excelLibrary()).Workbook();
  try {
    await book.xlsx.load(buffer);
  } catch (_) {
    out.errors.push("无法读取 Excel，请使用导出的 .xlsx 管理员配置模板。");
    return out;
  }
  if (initialScope !== scope(state)) {
    out.errors.push("读取文件期间配置已变化，请重新预览。");
    return out;
  }
  if (
    book.worksheets.length !== 2 ||
    !book.getWorksheet("模板说明") ||
    !book.getWorksheet(SHEET)
  ) {
    out.errors.push("工作簿必须包含且仅包含“模板说明”和“预算与归属”两张表。");
    return out;
  }
  const info = book.getWorksheet("模板说明"),
    sheet = book.getWorksheet(SHEET);
  if (sheet.rowCount > 5000) {
    out.errors.push("模板行数超过限制，请只保留需要修改或新增的配置行。");
    return out;
  }
  const add = (message) => {
    if (out.errors.length < 100) out.errors.push(message);
  };
  book.worksheets.forEach((s) =>
    s.eachRow((row, r) =>
      row.eachCell((cell, c) => {
        if (cell.value != null && typeof cell.value === "object")
          add(
            `${s.name} 第 ${r} 行第 ${c} 列不允许公式、链接或其他非纯文本内容。`,
          );
      }),
    ),
  );
  HEADERS.forEach((heading, c) => {
    if (sheet.getRow(1).getCell(c + 1).value !== heading)
      add(`表头第 ${c + 1} 列应为“${heading}”。`);
  });
  sheet.getRow(1).eachCell((cell, c) => {
    if (c > HEADERS.length && cell.value != null && cell.value !== "")
      add("表头含模板范围外的列，请保留原模板结构。");
  });
  if (info.rowCount !== 5) {
    add("模板说明只应包含四条导入规则。");
  }
  ["部门与资源类型", "发布规则", "写入影响", "适用范围"].forEach(
    (label, index) => {
      if (info.getRow(index + 2).getCell(1).value !== label)
        add(`模板说明第 ${index + 2} 行应为“${label}”。`);
    },
  );
  const byBusinessKey = new Map(
      initial.initiatives.map((i) => [
        json([i.sector, i.department, i.resourceType, i.name]),
        i,
      ]),
    ),
    seen = new Set();
  const text = (value) =>
    typeof value === "string" || typeof value === "number"
      ? String(value).trim()
      : "";
  const parseBudget = (value) =>
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+(\.\d{1,2})?$/.test(value.trim())
        ? Number(value.trim())
        : NaN;
  const validateOwner = (rowNumber, item, ownerId) => {
    if (identity.apiMode) {
      const owner = users.find(
        (user) => user.email === ownerId && user.role === "owner",
      );
      if (
        !owner ||
        owner.department !== item.department
      )
        add(
          `第 ${rowNumber} 行：Owner 必须是项目部门内已配置的 Owner 邮箱。`,
        );
    } else if (
      ![item.department + "-1", item.department + "-2"].includes(ownerId)
    )
      add(
        `第 ${rowNumber} 行：Owner 必须为 ${item.department}-1 或 ${item.department}-2。`,
      );
  };
  sheet.eachRow((row, r) => {
    if (r === 1) return;
    const cells = Array.from({ length: HEADERS.length }, (_, c) => row.getCell(c + 1).value);
    if (cells.every((v) => v == null || v === "")) {
      if (row.values.some((v) => v != null && v !== ""))
        add(`第 ${r} 行存在模板范围外的数据。`);
      return;
    }
    out.rows++;
    row.eachCell((cell, c) => {
      if (c > HEADERS.length && cell.value != null && cell.value !== "")
        add(`第 ${r} 行存在多余的第 ${c} 列。`);
    });
    const item = {
      name: text(cells[0]),
      sector: text(cells[1]),
      resourceType: text(cells[2]),
      department: text(cells[3]),
      ownerId: text(cells[4]),
      budget: parseBudget(cells[5]),
    };
    if (!item.name || item.name.length > 255)
      add(`第 ${r} 行：Initiative 名称不能为空且最多 255 个字符。`);
    if (!item.sector || item.sector.length > 32)
      add(`第 ${r} 行：Sector 不能为空且最多 32 个字符。`);
    if (!RESOURCE_DEPARTMENT[item.resourceType])
      add(`第 ${r} 行：资源类型必须为 MRD、SP&A、ICE Rebate 或 Capex。`);
    if (RESOURCE_DEPARTMENT[item.resourceType] !== item.department)
      add(`第 ${r} 行：资源类型与部门不匹配。`);
    validateOwner(r, item, item.ownerId);
    if (!engine.validMoney(item.budget))
      add(`第 ${r} 行：预算须为非负金额，最多两位小数，不能为空。`);
    const key = json([item.sector, item.department, item.resourceType, item.name]);
    if (seen.has(key)) {
      add(`第 ${r} 行：同部门、Sector 和资源类型下 Initiative 名称重复。`);
      return;
    }
    seen.add(key);
    const i = byBusinessKey.get(key);
    if (!i) {
      out.creates.push({ ...item, row: r });
      return;
    }
    if (item.budget === i.budget && item.ownerId === i.ownerId) {
      out.unchanged++;
      return;
    }
    out.changes.push({
      id: i.id,
      name: i.name,
      department: i.department,
      before: { budget: i.budget, ownerId: i.ownerId },
      after: { budget: item.budget, ownerId: item.ownerId },
      revision: i.revision,
    });
  });
  if (!out.rows) add("模板中没有可读取的配置行。");
  if (!out.errors.length) {
    const updates = out.changes.map((c) => ({
      id: c.id,
      budget: c.after.budget,
      ownerId: c.after.ownerId,
      revision: c.revision,
    }));
    const candidate = clone(initial);
    try {
      if (updates.length || out.creates.length)
        engine.applyAdminConfiguration(
          candidate,
          updates,
          identity,
          users,
          out.creates.map(({ row, ...item }) => item),
        );
      out.summary.after = engine.totals(candidate.initiatives).budget;
    } catch (e) {
      add(e.message);
    }
    if (!out.errors.length)
      tickets.set(out, {
        value: json(out),
        identity: json(identity),
        scope: initialScope,
        updates,
        creates: out.creates.map(({ row, ...item }) => item),
        users: clone(users),
      });
  }
  return out;
}
function confirmImport(preview, state, identity) {
  admin(identity);
  const ticket = preview && tickets.get(preview);
  if (!ticket || preview.errors.length || ticket.value !== json(preview))
    throw Error("预览无效或已被修改，请重新导入。");
  if (ticket.identity !== json(identity) || ticket.scope !== scope(state))
    throw Error("身份、配置或锁定状态已变化，请重新预览。");
  if (!ticket.updates.length && !ticket.creates.length)
    throw Error("配置没有变化，无需写入。");
  const applied = engine.applyAdminConfiguration(
    state,
    ticket.updates,
    identity,
    ticket.users,
    ticket.creates,
  );
  tickets.delete(preview);
  return applied;
}

export default { exportWorkbook, previewImport, confirmImport };
