import engine from "./engine.js";
import { initiativeDealers, isActiveDealer } from "./dealer-history";
const excelLibrary = async () => (await import("exceljs")).default;
("use strict");
const LEGACY_FORMAT = "资源投资分配模板 V1.3",
  LEGACY_POOL_FORMAT = "资源投资分配模板 V1.2";
const META = [
  "Initiative名称",
  "资源类型",
  "Sector",
  "部门",
  "Owner编号",
  "预算（只读）",
  "草稿修订号",
];
const LEGACY_META = ["模板版本", "Initiative编号", ...META];
const HEAD = ["经销商编码", "分配金额", "说明"],
  ALLOCATION_HEAD = ["经销商编码", "经销商名称", "状态", "SD", "RSM", "分配金额", "说明", "记录标识"],
  LEGACY_HEAD = ["行业务键", "经销商编码", "分配金额", "说明"],
  OTHER_HEAD = ["原因类型", "分配金额", "说明"],
  LEGACY_OTHER_HEAD = [
    "预算项编号（留空表示新增）",
    "原因",
    "金额",
    "填写原因",
  ],
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
    !["owner", "lead"].includes(identity.role) ||
    !identity.ownerId || String(identity.ownerId).toLowerCase() !== String(i.ownerId || "").toLowerCase() ||
    !engine.hasDepartment(identity, i.department) ||
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
function dealerDirectory(data = {}) {
  const rows = Array.isArray(data.distributorDirectory)
    ? data.distributorDirectory
    : Array.isArray(data.dealers)
      ? data.dealers
      : [];
  return [
    ...new Map(
      rows
        .filter(isActiveDealer)
        .map((dealer) => [
          json([String(dealer.id), dealer.sector || ""]),
          dealer,
        ]),
    ).values(),
  ];
}
async function exportWorkbook(state, id, identity, data = {}) {
  const i = editable(state, id, identity),
    book = new (await excelLibrary()).Workbook();
  book.creator = "资源投资工作台（本地演示）";
  const rows = book.addWorksheet("经销商分配", { properties: { tabColor: { argb: "FFFFCC00" } } });
  book.views = [{ activeTab: 0, firstSheet: 0 }];
  const historical = [...dealerDirectory(data), ...(data.dealers || [])];
  const byId = new Map(historical.filter((dealer) => !dealer.sector || dealer.sector === i.sector).map((dealer) => [String(dealer.id), dealer]));
  rows.addRow(ALLOCATION_HEAD);
  (i.rows || []).forEach((r) => {
    const dealer = byId.get(String(r.dealerId)) || {};
    rows.addRow([String(dealer.code || r.dealerCode || r.dealerId), dealer.name || "", dealer.status || "", dealer.sd || r.sd || "", dealer.rsm || r.rsm || "", r.amount, r.note || "", String(r.dealerId)]);
  });
  style(rows, [24, 48, 18, 24, 24, 20, 65, 24, 20]);
  rows.getColumn(6).numFmt = "#,##0.00";
  rows.getColumn(8).hidden = true;
  rows.getColumn(9).hidden = true;
  rows.getCell("I1").value = json({ format: "allocation-v2", id: i.id, fields: fields(i).slice(0, -1), versionId: state.planningVersion?.id ?? null });
  addDealerDirectory(book, data);
  return book.xlsx.writeBuffer();
}
function addDealerDirectory(book, data) {
  const directory = book.addWorksheet("经销商列表");
  directory.addRow(["业务线", "经销商编码", "经销商名称", "SD", "RSM", "状态"]);
  dealerDirectory(data).forEach((dealer) =>
    directory.addRow([
      String(dealer.sector || ""),
      String(dealer.code || dealer.id),
      String(dealer.name || ""),
      String(dealer.sd || ""),
      String(dealer.rsm || ""),
      String(dealer.status || ""),
    ]),
  );
  style(directory, [20, 24, 48, 24, 24, 18]);
}
async function exportDealerDirectory(data) {
  const book = new (await excelLibrary()).Workbook();
  addDealerDirectory(book, data);
  return book.xlsx.writeBuffer();
}
async function exportSelectedRoster(rows, dealers, data = { dealers }) {
  const book = new (await excelLibrary()).Workbook();
  const sheet = book.addWorksheet("已选经销商");
  sheet.addRow([
    "经销商编码",
    "经销商名称",
    "SD",
    "RSM",
    "状态",
    "已分配（元）",
  ]);
  const byId = new Map(dealers.map((dealer) => [String(dealer.id), dealer]));
  for (const row of rows) {
    const dealer = byId.get(String(row.dealerId));
    if (!dealer || !isActiveDealer(dealer)) continue;
    sheet.addRow([
      String(dealer.code || dealer.id),
      dealer.name || "",
      dealer.sd || "",
      dealer.rsm || "",
      "Active",
      Number(row.amount || 0),
    ]);
  }
  style(sheet, [24, 48, 24, 24, 18, 24]);
  addDealerDirectory(book, data);
  return book.xlsx.writeBuffer();
}
function dealerMatchKey(code, sd, rsm) {
  return json([code, sd, rsm].map(value => String(value ?? "").trim()));
}
function activeDealerIndex(dealers, sector) {
  const matches = new Map();
  for (const dealer of dealers) {
    if (!isActiveDealer(dealer) || (dealer.sector && dealer.sector !== sector)) continue;
    const key = dealerMatchKey(dealer.code || dealer.id, dealer.sd, dealer.rsm);
    matches.set(key, matches.has(key) ? null : dealer);
  }
  return matches;
}
async function previewRosterImport(buffer, state, id, identity, dealers) {
  const out = { initiativeId: id, revision: null, rows: [], otherBudgets: [], errors: [], rosterEntries: [], summary: { before: 0, after: 0, gap: 0 } };
  let initiative;
  try { initiative = editable(state, id, identity); }
  catch (error) { out.errors.push(error.message); return out; }
  out.revision = initiative.revision;
  out.summary.before = engine.totals([initiative]).allocated;
  const previousRows = new Map(initiative.rows.map(row => [String(row.dealerId), row]));
  out.otherBudgets = clone(currentOther(initiative));
  const book = new (await excelLibrary()).Workbook();
  try { await book.xlsx.load(buffer); }
  catch { out.errors.push("文件不是可读取的 Excel 工作簿，请使用下载的名单 Excel。"); return out; }
  const sheet = book.getWorksheet("已选经销商");
  if (!sheet || book.worksheets.some((worksheet) => !["已选经销商", "经销商列表"].includes(worksheet.name))) { out.errors.push("请使用下载的已选经销商名单 Excel。"); return out; }
  if (sheet.rowCount > 5001) { out.errors.push("单次最多导入 5000 行。"); return out; }
  const read = readFactory(out);
  checkHeaders(read, out, sheet, ["经销商编码", "经销商名称", "SD", "RSM", "状态", "已分配（元）"]);
  checkWidth(out, sheet, 6);
  const activeDealers = activeDealerIndex(dealers, initiative.sector);
  const seen = new Set();
  for (let n = 2; n <= sheet.rowCount; n++) {
    const cells = [1, 2, 3, 4, 5, 6].map((column) => read(sheet, n, column));
    if (cells.every((value) => value === "")) continue;
    const [code, , sd, rsm, , amount] = cells;
    const dealer = activeDealers.get(dealerMatchKey(code, sd, rsm));
    if (!dealer) { out.errors.push(`第${n}行编码、SD、RSM 无法唯一匹配当前业务线的 Active 经销商。`); continue; }
    const dealerId = dealer.id;
    if (seen.has(String(dealerId))) { out.errors.push(`第${n}行经销商重复。`); continue; }
    seen.add(String(dealerId));
    const value = money(amount, out, `第${n}行金额`);
    const before = previousRows.get(String(dealerId)) ?? null;
    const after = before ? { ...before, amount: value } : { dealerId, amount: value, note: "" };
    out.rows.push(after);
    out.rosterEntries.push({ dealerId, before, after });
  }
  if (out.errors.length) return out;
  for (const [id, before] of previousRows) {
    if (!seen.has(id)) out.rosterEntries.push({ dealerId: before.dealerId, before, after: null });
  }
  const totals = engine.totals([{ ...initiative, rows: out.rows, otherBudgets: out.otherBudgets }]);
  out.summary.after = totals.allocated;
  out.summary.otherBudget = totals.otherBudget;
  out.summary.gap = totals.gap;
  return out;
}
function parseOtherV14(sheet, state, out, read) {
  checkHeaders(read, out, sheet, OTHER_HEAD);
  checkWidth(out, sheet, 3);
  const byLabel = new Map(configuredReasons(state).map((r) => [r.label, r])),
    ids = new Set();
  for (let n = 2; n <= sheet.rowCount; n++) {
    const [label, rawAmount, note] = [1, 2, 3].map((c) => read(sheet, n, c));
    if ([label, rawAmount, note].every((v) => v === "")) continue;
    const id = `import-other-${n}`;
    if (ids.has(id)) out.errors.push(`其他预算安排 第${n}行重复。`);
    ids.add(id);
    const reason = typeof label === "string" ? byLabel.get(label.trim()) : null;
    if (!reason)
      out.errors.push(
        `其他预算安排 第${n}行原因必须来自管理员配置的下拉选项。`,
      );
    else if (reason.enabled === false)
      out.errors.push(`其他预算安排 第${n}行不能新增已停用的原因。`);
    if (typeof note !== "string")
      out.errors.push(`其他预算安排 第${n}行说明必须为文本。`);
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
function parseOtherV13(sheet, state, out, read) {
  checkHeaders(read, out, sheet, LEGACY_OTHER_HEAD);
  checkWidth(out, sheet, 4);
  const byLabel = new Map(configuredReasons(state).map((r) => [r.label, r])),
    ids = new Set();
  let generated = 0;
  for (let n = 2; n <= sheet.rowCount; n++) {
    const [rawId, label, rawAmount, note] = [1, 2, 3, 4].map((c) =>
      read(sheet, n, c),
    );
    if ([rawId, label, rawAmount, note].every((v) => v === "")) continue;
    const id =
      rawId === "" ? `import-other-${++generated}` : String(rawId).trim();
    if (!id || ids.has(id))
      out.errors.push(`其他预算安排 第${n}行预算项编号无效或重复。`);
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
  if (book.worksheets.length === 2 && book.getWorksheet("经销商分配") && book.getWorksheet("经销商列表")) {
    const sheet = book.getWorksheet("经销商分配"), read = readFactory(out);
    let metadata;
    try { metadata = JSON.parse(read(sheet, 1, 9)); } catch { /* Invalid metadata is rejected below. */ }
    if (!metadata || metadata.format !== "allocation-v2" || metadata.id !== i.id ||
        json(metadata.fields) !== json(fields(i).slice(0, -1)) ||
        metadata.versionId !== (state.planningVersion?.id ?? null))
      out.errors.push("模板所属方案或版本与当前方案不一致，请重新下载模板。");
    checkHeaders(read, out, sheet, ALLOCATION_HEAD);
    checkWidth(out, sheet, 9);
    const activeDealers = activeDealerIndex(
      initiativeDealers(data.dealers || [], data.distributorDirectory || [], i.sector), i.sector,
    );
    const ids = new Set();
    for (let n = 2; n <= sheet.rowCount; n++) {
      const row = ALLOCATION_HEAD.map((_, column) => read(sheet, n, column + 1));
      if (row.every((value) => value === "")) continue;
      const [code, , , sd, rsm, amount, note] = row;
      const match = activeDealers.get(dealerMatchKey(code, sd, rsm));
      if (!match) {
        out.errors.push(`经销商分配 第${n}行编码、SD、RSM 无法唯一匹配当前业务线的 Active 经销商。`);
        continue;
      }
      const dealer = match.id;
      if (ids.has(dealer)) out.errors.push(`经销商分配 第${n}行经销商重复。`);
      if (typeof note !== "string") out.errors.push(`经销商分配 第${n}行说明必须为文本。`);
      ids.add(dealer);
      out.rows.push({ dealerId: dealer, amount: money(amount, out, `经销商分配 第${n}行金额`), note: safeText(note) });
    }
    out.otherBudgets = clone(currentOther(i));
    out.dealerOnly = true;
    return finishPreview(out, i, identity, scope);
  }
  const read = readFactory(out),
    meta = book.getWorksheet("模板信息"),
    ds = book.getWorksheet("经销商分配"),
    isV14 =
      book.worksheets.length === 5 &&
      [
        "模板信息",
        "经销商分配",
        "其他预算安排",
        "经销商列表",
        "原因类型参考",
      ].every((name) => book.getWorksheet(name)),
    templateFormat = isV14 ? "" : meta && read(meta, 2, 2),
    isLegacyPool = templateFormat === LEGACY_POOL_FORMAT,
    isLegacy = templateFormat === LEGACY_FORMAT || isLegacyPool,
    other = book.getWorksheet(isLegacyPool ? "预算池" : "其他预算安排"),
    expected = isV14
      ? ["模板信息", "经销商分配", "其他预算安排", "经销商列表", "原因类型参考"]
      : ["模板信息", "经销商分配", isLegacyPool ? "预算池" : "其他预算安排"];
  if (
    book.worksheets.length !== expected.length ||
    expected.some((n) => !book.getWorksheet(n))
  ) {
    out.errors.push(`模板必须且只能包含：${expected.join("、")}。`);
    return out;
  }
  [meta, ds, other].forEach((s) =>
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
  const metaFields = isLegacy
    ? [
        templateFormat,
        i.id,
        i.name,
        i.resourceType,
        i.sector,
        i.department,
        i.ownerId,
        i.budget,
        i.revision,
      ]
    : fields(i);
  const metaLabels = isLegacy ? LEGACY_META : META;
  metaFields.forEach((v, ix) => {
    const label = read(meta, ix + 2, 1),
      value = read(meta, ix + 2, 2);
    out.fileScope[metaLabels[ix]] = value;
    if (label !== metaLabels[ix] || (metaLabels[ix] !== "草稿修订号" && value !== v))
      out.errors.push(
        `模板信息「${metaLabels[ix]}」与当前方案不一致，请重新下载当前模板。`,
      );
  });
  if (meta.rowCount > (isV14 ? 9 : 11))
    out.errors.push("模板信息含额外行，请使用原始模板。");
  checkHeaders(read, out, ds, isV14 ? HEAD : LEGACY_HEAD);
  const detailed = isV14 && read(ds, 1, 6) === "记录标识";
  checkWidth(out, ds, detailed ? 6 : isV14 ? 3 : 4);
  const sourceRecords = initiativeDealers(data.dealers || [], data.distributorDirectory || [], i.sector).filter(isActiveDealer);
  const dealers = new Set(sourceRecords.map(dealer => dealer.id)),
    keys = new Set(),
    ids = new Set();
  for (let n = 2; n <= ds.rowCount; n++) {
    const row = Array.from({ length: isV14 ? 3 : 4 }, (_, c) =>
      read(ds, n, c + 1),
    );
    if (row.every((v) => v === "")) continue;
    const [key, inputDealer, amount, note] = isV14
      ? [null, row[0], row[1], row[2]]
      : row;
    let dealer = inputDealer;
    if (detailed) {
      const sd = String(read(ds, n, 4) || ""),
        rsm = String(read(ds, n, 5) || "");
      const matches = [
        ...new Map(
          sourceRecords
            .filter(
              (record) =>
                (!record.sector || record.sector === i.sector) &&
                String(record.code || record.id) === String(inputDealer) &&
                (record.sd || "") === sd &&
                (record.rsm || "") === rsm,
            )
            .map((record) => [String(record.id), record]),
        ).values(),
      ];
      dealer = matches.length === 1 ? String(matches[0].id) : read(ds, n, 6);
      if (
        matches.length !== 1 &&
        !i.rows.some(
          (old) =>
            old.dealerId === dealer &&
            (old.dealerCode || old.dealerId) === inputDealer,
        )
      )
        out.errors.push(
          `经销商分配 第${n}行编码、SD、RSM 无法唯一匹配历史记录。`,
        );
    }
    if (typeof dealer !== "string" || !dealers.has(dealer))
      out.errors.push(`经销商分配 第${n}行经销商编码不存在或格式不正确。`);
    if (!isV14 && key !== i.id + "::" + dealer)
      out.errors.push(`经销商分配 第${n}行行业务键应为 ${i.id}::${dealer}。`);
    if ((!isV14 && keys.has(key)) || ids.has(dealer))
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
  if (isLegacyPool) parseLegacyPool(other, out, read);
  else if (isV14) parseOtherV14(other, state, out, read);
  else parseOtherV13(other, state, out, read);
  if (isV14) {
    const existing = currentOther(i);
    out.otherBudgets = out.otherBudgets.map((row, index) => {
      const previous = existing[index];
      return previous && previous.reasonId === row.reasonId
        ? { ...row, id: previous.id }
        : row;
    });
  }
  return finishPreview(out, i, identity, scope);
}
function finishPreview(out, i, identity, scope) {
  if (
    !out.dealerOnly && !out.rows.length &&
    !out.otherBudgets.some((r) => r.amount > 0 && r.note.trim())
  )
    out.errors.push(
      "至少填写一条经销商明细，或填写有原因且金额大于0的其他预算安排。",
    );
  const before = new Map(i.rows.map((r) => [r.dealerId, r])),
    after = new Map(out.rows.map((r) => [r.dealerId, r]));
  out.rows = out.rows.map(row => ({ ...before.get(row.dealerId), ...row }));
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

export default {
  exportWorkbook,
  exportDealerDirectory,
  exportSelectedRoster,
  previewRosterImport,
  previewImport,
  confirmImport,
};
