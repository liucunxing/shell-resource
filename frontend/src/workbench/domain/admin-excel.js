import engine from "./engine.js";
const excelLibrary = async () => (await import("exceljs")).default;
("use strict");
const FORMAT = "资源投资管理员配置 V1.3";
const SHEET = "预算与归属";
const HEADERS = [
  "Initiative编号",
  "Initiative名称（只读）",
  "Sector（只读）",
  "资源类型（只读）",
  "部门（只读）",
  "Owner编号",
  "预算金额",
  "修订号（只读）",
  "状态（只读）",
];
const tickets = new WeakMap();
const json = (value) => JSON.stringify(value);
const clone = (value) => JSON.parse(json(value));
function admin(identity) {
  if (!identity || identity.role !== "admin")
    throw Error("仅管理员可导入或导出管理员配置。");
}
const statusLabel = (state, i) =>
  Array.isArray(state.publications && state.publications[i.id]) &&
  state.publications[i.id].length
    ? "已发布（可更新）"
    : "编辑中（可更新）";
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
    ["模板版本", FORMAT],
    ["可编辑列", "预算与归属表的 Owner编号、预算金额；浅蓝色列可编辑。"],
    [
      "匹配方式",
      "按 Initiative编号更新已有项目。可仅保留需调整的项目；未列出的项目不变，不新增或删除项目。",
    ],
    [
      "导入规则",
      identity.apiMode
        ? "预算非负、最多两位小数，不接受公式；Owner 填写已配置且符合部门和业务范围的邮箱。固定列与修订号请保留。"
        : "预算非负、最多两位小数，不接受公式；Owner 只能是本部门的 -1 或 -2。固定列与修订号请保留。",
    ],
    [
      "发布规则",
      "已发布 Initiative 仍可更新预算或 Owner；管理层保留最近一次发布快照，Owner 重新发布后才会更新该快照。",
    ],
    [
      "写入影响",
      "预览后确认才整批写入。预算/Owner 变化不移动经销商分配，也不改写既有发布快照。",
    ],
    [
      "适用范围",
      "此模板只维护预算与 Owner 归属，不包含分配明细、历史参考、人员权限或分析指南。",
    ],
  ]);
  style(info, [20, 110]);
  info.getColumn(2).alignment = { vertical: "middle", wrapText: true };
  for (let r = 3; r <= 8; r++) info.getRow(r).height = 40;
  const sheet = book.addWorksheet(SHEET);
  sheet.addRow(HEADERS);
  state.initiatives.forEach((i) =>
    sheet.addRow([
      i.id,
      i.name,
      i.sector,
      i.resourceType,
      i.department,
      i.ownerId,
      i.budget,
      i.revision,
      statusLabel(state, i),
    ]),
  );
  style(sheet, [24, 34, 18, 20, 18, 20, 22, 20, 18]);
  sheet.autoFilter = { from: "A1", to: "I1" };
  sheet.getColumn(7).numFmt = "#,##0.00";
  for (let r = 2; r <= sheet.rowCount; r++) {
    for (const c of [6, 7])
      sheet.getRow(r).getCell(c).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFEAF1FB" },
      };
    if (!identity.apiMode)
      sheet.getRow(r).getCell(6).dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: [
          '"' +
            sheet.getRow(r).getCell(5).value +
            "-1," +
            sheet.getRow(r).getCell(5).value +
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
  if (info.getCell("B2").value !== FORMAT) {
    out.errors.push("模板版本不匹配，请重新导出当前管理员配置。");
    return out;
  }
  if (sheet.rowCount > 5000) {
    out.errors.push("模板行数超过限制，请只保留已有项目的配置行。");
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
    if (c > 9 && cell.value != null && cell.value !== "")
      add("表头含模板范围外的列，请保留原模板结构。");
  });
  const byId = new Map(initial.initiatives.map((i) => [i.id, i])),
    seen = new Set();
  sheet.eachRow((row, r) => {
    if (r === 1) return;
    const cells = Array.from({ length: 9 }, (_, c) => row.getCell(c + 1).value);
    if (cells.every((v) => v == null || v === "")) {
      if (row.values.some((v) => v != null && v !== ""))
        add(`第 ${r} 行存在模板范围外的数据。`);
      return;
    }
    out.rows++;
    row.eachCell((cell, c) => {
      if (c > 9 && cell.value != null && cell.value !== "")
        add(`第 ${r} 行存在多余的第 ${c} 列。`);
    });
    const id = typeof cells[0] === "string" ? cells[0].trim() : "";
    if (seen.has(id)) {
      add(`第 ${r} 行：Initiative ${id} 重复。`);
      return;
    }
    seen.add(id);
    const i = byId.get(id);
    if (!i) {
      add(`第 ${r} 行：Initiative 编号不存在，不支持新增项目。`);
      return;
    }
    [i.name, i.sector, i.resourceType, i.department].forEach((expected, n) => {
      if (cells[n + 1] !== expected)
        add(`第 ${r} 行：${HEADERS[n + 1]}不可修改。`);
    });
    const ownerId = typeof cells[5] === "string" ? cells[5].trim() : "";
    if (identity.apiMode) {
      const owner = users.find(
        (user) => user.email === ownerId && user.role === "owner",
      );
      if (
        !owner ||
        owner.department !== i.department ||
        (owner.sector && owner.sector !== i.sector)
      )
        add(
          `第 ${r} 行：Owner 必须是项目部门及业务范围内已配置的 Owner 邮箱。`,
        );
    } else if (![i.department + "-1", i.department + "-2"].includes(ownerId))
      add(`第 ${r} 行：Owner 必须为 ${i.department}-1 或 ${i.department}-2。`);
    const raw = cells[6];
    const budget =
      typeof raw === "number"
        ? raw
        : typeof raw === "string" && /^\d+(\.\d{1,2})?$/.test(raw.trim())
          ? Number(raw.trim())
          : NaN;
    if (!engine.validMoney(budget))
      add(`第 ${r} 行：预算须为非负金额，最多两位小数，不能为空。`);
    if (!Number.isInteger(cells[7]) || cells[7] < (identity.apiMode ? 0 : 1))
      add(`第 ${r} 行：修订号必须为原模板中的整数。`);
    if (cells[8] !== statusLabel(initial, i))
      add(`第 ${r} 行：状态列不可修改。`);
    if (budget === i.budget && ownerId === i.ownerId) {
      out.unchanged++;
      return;
    }
    if (cells[7] !== i.revision)
      add(`第 ${r} 行：${id} 修订已变化，请重新导出后调整。`);
    out.changes.push({
      id,
      name: i.name,
      department: i.department,
      before: { budget: i.budget, ownerId: i.ownerId },
      after: { budget, ownerId },
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
      if (updates.length)
        engine.applyAdminConfiguration(candidate, updates, identity, users);
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
  if (!ticket.updates.length) throw Error("配置没有变化，无需写入。");
  const applied = engine.applyAdminConfiguration(
    state,
    ticket.updates,
    identity,
    ticket.users,
  );
  tickets.delete(preview);
  return applied;
}

export default { exportWorkbook, previewImport, confirmImport };
