import engine from "./engine.js";
const excelLibrary = async () => (await import("exceljs")).default;
("use strict");
const FORMAT = "资源投资分配模板 V1.3",
  LEGACY_FORMAT = "资源投资分配模板 V1.2";
const META = [
  "模板版本",
  "Initiative编号",
  "Initiative名称",
  "资源类型",
  "Sector",
  "部门",
  "Owner编号",
  "预算（只读）",
  "草稿修订号",
];
const HEAD = ["行业务键", "经销商编码", "分配金额", "说明"],
  OTHER_HEAD = ["预算项编号（留空表示新增）", "原因", "金额", "填写原因"],
  LEGACY_POOL = ["预算池类型", "金额", "说明"];
const DEFAULT_REASONS = [
  { id: "reserve", label: "新增经销商预留", enabled: true },
  { id: "unallocated", label: "无法分配到经销商", enabled: true },
  { id: "other", label: "其他支出", enabled: true },
];
const tickets = new WeakMap(),
  json = (x) => JSON.stringify(x),
  clone = (x) => JSON.parse(json(x));
const round = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const configuredReasons = (s) =>
  (Array.isArray(s.budgetReasons) && s.budgetReasons.length
    ? s.budgetReasons
    : DEFAULT_REASONS
  ).filter((r) => r && typeof r.id === "string" && typeof r.label === "string");
const reasons = (s) => configuredReasons(s).filter((r) => r.enabled !== false);
const currentOther = (i) =>
  Array.isArray(i.otherBudgets)
    ? i.otherBudgets
    : [
        ...(Number(i.reserve) || i.reserveNote
          ? [
              {
                id: "legacy-reserve",
                reasonId: "reserve",
                amount: Number(i.reserve || 0),
                note: String(i.reserveNote || ""),
              },
            ]
          : []),
        ...(Number(i.nonDealer) || i.nonDealerNote
          ? [
              {
                id: "legacy-other",
                reasonId: "other",
                amount: Number(i.nonDealer || 0),
                note: String(i.nonDealerNote || ""),
              },
            ]
          : []),
      ];
const total = (i) =>
  round(
    (i.rows || []).reduce((s, r) => s + Number(r.amount || 0), 0) +
      currentOther(i).reduce((s, r) => s + Number(r.amount || 0), 0),
  );
const fields = (i) => [
  FORMAT,
  i.id,
  i.name,
  i.resourceType,
  i.sector,
  i.department,
  i.ownerId,
  i.budget,
  i.revision,
];
function editable(state, id, identity) {
  const i = state.initiatives.find((x) => x.id === id);
  if (!i) throw new Error("当前 Initiative 不存在");
  if (
    identity.role !== "owner" ||
    identity.ownerId !== i.ownerId ||
    identity.department !== i.department ||
    !engine.canEdit(state, id, identity)
  )
    throw new Error("当前身份或方案状态不允许修改该 Initiative");
  return i;
}
function style(sheet, widths) {
  widths.forEach((w, ix) => {
    sheet.getColumn(ix + 1).width = w;
  });
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF214D60" },
  };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}
function safeText(v) {
  return typeof v === "string" ? v : "";
}
function money(value, out, where) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    !Number.isSafeInteger(Math.round(value * 100)) ||
    Math.abs(value * 100 - Math.round(value * 100)) > 0.000001
  ) {
    out.errors.push(
      where + "须为不小于0的数值，最多2位小数（不能留空或填写公式）。",
    );
    return 0;
  }
  return round(value);
}
function readFactory(out) {
  return (s, r, c) => {
    const v = s.getRow(r).getCell(c).value;
    if (v == null) return "";
    if (typeof v === "object" || typeof v === "boolean") {
      out.errors.push(
        `${s.name} 第${r}行第${c}列不支持公式、日期或特殊单元格，请填写普通文本或数值。`,
      );
      return "";
    }
    return v;
  };
}
function checkHeaders(read, out, s, head) {
  head.forEach((v, ix) => {
    if (read(s, 1, ix + 1) !== v) out.errors.push(`${s.name} 表头不匹配：${v}`);
  });
}
function checkWidth(out, s, max) {
  s.eachRow((row, n) =>
    row.eachCell((cell, c) => {
      if (c > max && cell.value != null && cell.value !== "")
        out.errors.push(`${s.name} 第${n}行含额外字段。`);
    }),
  );
}
function addValidation(sheet, state) {
  const labels = reasons(state)
    .map((r) => r.label.replace(/"/g, ""))
    .join(",");
  const lastRow = Math.max(sheet.rowCount + 20, 30);
  for (let row = 2; row <= lastRow; row++)
    sheet.getRow(row).getCell(2).dataValidation = {
      type: "list",
      allowBlank: false,
      formulae: ['"' + labels + '"'],
      showErrorMessage: true,
      error: "请选择管理员配置的预算安排原因。",
    };
}
async function exportWorkbook(state, id, identity) {
  const i = editable(state, id, identity),
    book = new (await excelLibrary()).Workbook();
  book.creator = "资源投资工作台（本地演示）";
  const meta = book.addWorksheet("模板信息");
  meta.addRow(["字段", "值（固定属性请勿修改）"]);
  fields(i).forEach((v, ix) => meta.addRow([META[ix], v]));
  meta.addRow([
    "填写说明",
    "仅编辑经销商分配与其他预算安排。其他预算安排可新增多行：选择原因、填写金额和填写原因；预算项编号留空即新增。删除明细行将删除当前分配。金额最多2位小数，不得填写公式。导入前预览，确认后写入。",
  ]);
  style(meta, [26, 110]);
  meta.getRow(11).getCell(2).alignment = { wrapText: true };
  meta.getRow(11).height = 56;
  const rows = book.addWorksheet("经销商分配");
  rows.addRow(HEAD);
  (i.rows || []).forEach((r) =>
    rows.addRow([i.id + "::" + r.dealerId, r.dealerId, r.amount, r.note || ""]),
  );
  style(rows, [46, 24, 20, 65]);
  rows.getColumn(3).numFmt = "#,##0.00";
  const other = book.addWorksheet("其他预算安排");
  other.addRow(OTHER_HEAD);
  currentOther(i).forEach((r) => {
    const reason = configuredReasons(state).find((x) => x.id === r.reasonId);
    other.addRow([
      r.id || "",
      reason ? reason.label : r.reasonId,
      r.amount,
      r.note || "",
    ]);
  });
  style(other, [28, 26, 20, 70]);
  other.getColumn(3).numFmt = "#,##0.00";
  // Validation is intentionally applied only to populated rows. Some older ExcelJS
  // builds expand a worksheet indefinitely when data validation is set on blank rows.
  for (let row = 2; row <= other.rowCount; row++)
    other.getRow(row).getCell(2).dataValidation = {
      type: "list",
      allowBlank: false,
      formulae: [
        '"' +
          reasons(state)
            .map((r) => r.label.replace(/"/g, ""))
            .join(",") +
          '"',
      ],
      showErrorMessage: true,
      error: "请选择管理员配置的预算安排原因。",
    };
  return book.xlsx.writeBuffer();
}
function parseOtherV13(sheet, state, out, read) {
  checkHeaders(read, out, sheet, OTHER_HEAD);
  checkWidth(out, sheet, 4);
  const byLabel = new Map(configuredReasons(state).map((r) => [r.label, r])),
    ids = new Set();
  let generated = 0;
  for (let n = 2; n <= sheet.rowCount; n++) {
    const [rawId, label, rawAmount, note] = [1, 2, 3, 4].map((c) =>
      read(sheet, n, c),
    );
    if ([rawId, label, rawAmount, note].every((v) => v === "")) continue;
    if (rawId !== "" && typeof rawId !== "string")
      out.errors.push(`其他预算安排 第${n}行预算项编号必须为文本或留空。`);
    const id =
      rawId === "" ? `import-other-${++generated}` : String(rawId).trim();
    if (!id) out.errors.push(`其他预算安排 第${n}行预算项编号无效。`);
    if (ids.has(id)) out.errors.push(`其他预算安排 第${n}行预算项编号重复。`);
    ids.add(id);
    const reason = typeof label === "string" ? byLabel.get(label.trim()) : null;
    if (!reason)
      out.errors.push(
        `其他预算安排 第${n}行原因必须来自管理员配置的下拉选项。`,
      );
    else if (rawId === "" && reason.enabled === false)
      out.errors.push(`其他预算安排 第${n}行不能新增已停用的原因。`);
    if (typeof note !== "string")
      out.errors.push(`其他预算安排 第${n}行填写原因必须为文本。`);
    const amount = money(rawAmount, out, `其他预算安排 第${n}行金额`);
    if (amount > 0 && !safeText(note).trim())
      out.errors.push(`其他预算安排 第${n}行金额大于0时必须填写原因。`);
    out.otherBudgets.push({
      id,
      reasonId: reason ? reason.id : "",
      amount,
      note: safeText(note),
    });
  }
}
function parseLegacyPool(sheet, out, read) {
  checkHeaders(read, out, sheet, LEGACY_POOL);
  checkWidth(out, sheet, 3);
  [
    ["新增经销商预留", "reserve"],
    ["非经销商支出", "other"],
  ].forEach(([label, reasonId], ix) => {
    const n = ix + 2,
      type = read(sheet, n, 1),
      amount = money(read(sheet, n, 2), out, `预算池「${label}」金额`),
      note = read(sheet, n, 3);
    if (type !== label)
      out.errors.push(`预算池 第${n}行类型应为「${label}」。`);
    if (typeof note !== "string")
      out.errors.push(`预算池「${label}」说明必须为文本。`);
    if (amount > 0 && !safeText(note).trim())
      out.errors.push(`预算池「${label}」金额大于0时必须填写说明。`);
    if (amount > 0 || safeText(note))
      out.otherBudgets.push({
        id: `legacy-${reasonId}`,
        reasonId,
        amount,
        note: safeText(note),
      });
  });
  for (let n = 4; n <= sheet.rowCount; n++)
    if ([1, 2, 3].some((c) => read(sheet, n, c) !== ""))
      out.errors.push(`预算池 第${n}行不是允许的预算池类型。`);
}
async function previewImport(buffer, state, id, identity, data) {
  const out = {
    initiativeId: id,
    revision: null,
    rows: [],
    otherBudgets: [],
    errors: [],
    changes: [],
    summary: { before: 0, after: 0, gap: 0 },
    fileScope: {},
  };
  let i;
  try {
    i = editable(state, id, identity);
  } catch (e) {
    out.errors.push(e.message);
    return out;
  }
  out.revision = i.revision;
  out.summary.before = total(i);
  const scope = json(fields(i)),
    book = new (await excelLibrary()).Workbook();
  try {
    await book.xlsx.load(buffer);
  } catch (_) {
    out.errors.push("文件不是可读取的 Excel 工作簿，请使用下载的 .xlsx 模板。");
    return out;
  }
  const read = readFactory(out),
    meta = book.getWorksheet("模板信息"),
    ds = book.getWorksheet("经销商分配"),
    isLegacy = meta && read(meta, 2, 2) === LEGACY_FORMAT,
    other = book.getWorksheet(isLegacy ? "预算池" : "其他预算安排"),
    expected = ["模板信息", "经销商分配", isLegacy ? "预算池" : "其他预算安排"];
  if (
    book.worksheets.length !== 3 ||
    expected.some((n) => !book.getWorksheet(n))
  ) {
    out.errors.push("模板必须且只能包含：模板信息、经销商分配、其他预算安排。");
    return out;
  }
  book.worksheets.forEach((s) =>
    s.eachRow((row, n) =>
      row.eachCell((cell, c) => {
        const v = cell.value;
        if (
          v &&
          typeof v === "object" &&
          ("formula" in v || "sharedFormula" in v)
        )
          out.errors.push(
            `${s.name} 第${n}行第${c}列含公式，导入模板不允许公式。`,
          );
      }),
    ),
  );
  checkHeaders(read, out, meta, ["字段", "值（固定属性请勿修改）"]);
  checkWidth(out, meta, 2);
  const metaFields = fields(i);
  metaFields[0] = isLegacy ? LEGACY_FORMAT : FORMAT;
  metaFields.forEach((v, ix) => {
    const label = read(meta, ix + 2, 1),
      value = read(meta, ix + 2, 2);
    out.fileScope[META[ix]] = value;
    if (label !== META[ix] || value !== v)
      out.errors.push(
        `模板信息「${META[ix]}」与当前方案不一致，请重新下载当前模板。`,
      );
  });
  if (meta.rowCount > 11) out.errors.push("模板信息含额外行，请使用原始模板。");
  checkHeaders(read, out, ds, HEAD);
  checkWidth(out, ds, 4);
  const dealers = new Set(data.dealers.map((d) => String(d.id))),
    keys = new Set(),
    ids = new Set();
  for (let n = 2; n <= ds.rowCount; n++) {
    const row = [1, 2, 3, 4].map((c) => read(ds, n, c));
    if (row.every((v) => v === "")) continue;
    const [key, dealer, amount, note] = row;
    if (typeof dealer !== "string" || !dealers.has(dealer))
      out.errors.push(`经销商分配 第${n}行经销商编码不存在或格式不正确。`);
    if (key !== i.id + "::" + dealer)
      out.errors.push(`经销商分配 第${n}行行业务键应为 ${i.id}::${dealer}。`);
    if (keys.has(key) || ids.has(dealer))
      out.errors.push(`经销商分配 第${n}行行业务键或经销商重复。`);
    if (typeof note !== "string")
      out.errors.push(`经销商分配 第${n}行说明必须为文本。`);
    keys.add(key);
    ids.add(dealer);
    out.rows.push({
      dealerId: dealer,
      amount: money(amount, out, `经销商分配 第${n}行金额`),
      note: safeText(note),
    });
  }
  if (isLegacy) parseLegacyPool(other, out, read);
  else parseOtherV13(other, state, out, read);
  if (
    !out.rows.length &&
    !out.otherBudgets.some((r) => r.amount > 0 && r.note.trim())
  )
    out.errors.push(
      "至少填写一条经销商明细，或填写有原因且金额大于0的其他预算安排。",
    );
  const before = new Map(i.rows.map((r) => [r.dealerId, r])),
    after = new Map(out.rows.map((r) => [r.dealerId, r]));
  new Set([...before.keys(), ...after.keys()]).forEach((dealerId) => {
    const a = before.get(dealerId),
      b = after.get(dealerId);
    if (!a || !b || a.amount !== b.amount || (a.note || "") !== (b.note || ""))
      out.changes.push({
        dealerId,
        before: a ? { ...a } : null,
        after: b ? { ...b } : null,
      });
  });
  if (json(currentOther(i)) !== json(out.otherBudgets))
    out.changes.push({
      otherBudgets: true,
      before: clone(currentOther(i)),
      after: clone(out.otherBudgets),
    });
  out.summary.after = round(
    out.rows.reduce((s, r) => s + r.amount, 0) +
      out.otherBudgets.reduce((s, r) => s + r.amount, 0),
  );
  out.summary.gap = round(i.budget - out.summary.after);
  if (!out.errors.length)
    tickets.set(out, { value: json(out), identity: json(identity), scope });
  return out;
}
function confirmImport(preview, state, identity, data) {
  if (!preview || !Array.isArray(preview.errors) || preview.errors.length)
    throw new Error("导入预览存在错误，不能写入。");
  const ticket = tickets.get(preview);
  if (!ticket || ticket.value !== json(preview))
    throw new Error("导入预览无效或已被修改，请重新预览。");
  if (ticket.identity !== json(identity))
    throw new Error("身份已变化，请重新预览导入。");
  const i = editable(state, preview.initiativeId, identity);
  if (i.revision !== preview.revision || ticket.scope !== json(fields(i)))
    throw new Error("方案版本或预算属性已变化，请重新下载模板。");
  const result = engine.updateInitiative(
    state,
    i.id,
    {
      rows: preview.rows.map((r) => ({ ...r })),
      otherBudgets: preview.otherBudgets.map((r) => ({ ...r })),
    },
    identity,
    data,
  );
  tickets.delete(preview);
  return result;
}

export default { exportWorkbook, previewImport, confirmImport };
