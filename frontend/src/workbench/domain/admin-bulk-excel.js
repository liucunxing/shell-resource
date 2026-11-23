const excelLibrary = async () => (await import("exceljs")).default;
const definitions = {
  users: {
    sheet: "用户信息",
    headers: [
      "登录邮箱",
      "姓名",
      "角色",
      "授权部门",
      "授权Sector",
      "启用",
      "所属Sector",
      "所属部门",
      "历史费用权限",
    ],
  },
  initiatives: {
    sheet: "Initiative归属",
    headers: [
      "项目ID",
      "Initiative名称",
      "Sector",
      "部门",
      "资源大类",
      "Owner邮箱",
      "预算（元）",
      "启用",
      "变化原因",
    ],
  },
};
const departments = ["MKT", "ICE", "CAPEX"];
const sectors = ["PCMO", "CRTO", "B2B", "OEM"];
const resources = ["MRD", "SP&A", "ICE Rebate", "Capex"];
const roles = ["owner", "lead", "management", "admin"];
const list = (value) =>
  value
    .split(/[,，;；、]/)
    .map((item) => item.trim())
    .filter(Boolean);
const email = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const enabled = (value) =>
  value === "启用" || value === "true" || value === "1";
const validEnabled = (value) =>
  ["启用", "停用", "true", "false", "1", "0"].includes(value);
const safeString = (cell) => {
  if (cell.value && typeof cell.value === "object") {
    if (cell.value.formula || cell.value.sharedFormula)
      throw Error("不接受公式，请粘贴为值后导入");
    if (cell.value.richText)
      return cell.value.richText
        .map((item) => item.text)
        .join("")
        .trim();
  }
  return String(cell.value ?? "").trim();
};
export function parseAdminRows(kind, rows, context = {}) {
  const definition = definitions[kind];
  if (!definition) throw Error("不支持的管理员模板");
  const errors = [],
    items = [],
    rowNumbers = [],
    seen = new Set();
  for (const { rowNumber, cells } of rows) {
    if (cells.every((value) => !value)) continue;
    const fail = (message) => errors.push({ row: rowNumber, message });
    const before = errors.length;
    if (kind === "users") {
      const [
        account,
        name,
        role,
        deps,
        scopes,
        active,
        homeSector,
        homeDepartment,
        history,
      ] = cells;
      const user = {
        email: account.toLowerCase(),
        display_name: name,
        role,
        department: list(deps),
        sector: list(scopes),
        enabled: enabled(active),
        affiliation_sector: homeSector,
        affiliation_department: homeDepartment,
        history_resources:
          !history || history === "默认"
            ? null
            : history === "无"
              ? []
              : list(history),
      };
      if (!email(user.email)) fail("登录邮箱格式无效");
      if (!name) fail("姓名必填");
      if (!roles.includes(role))
        fail("角色必须为 owner、lead、management 或 admin");
      if (!validEnabled(active)) fail("启用列须填启用/停用");
      if (
        !sectors.includes(homeSector) ||
        !departments.includes(homeDepartment)
      )
        fail("所属Sector和所属部门必须使用模板枚举");
      if (
        user.department.some((item) => !departments.includes(item)) ||
        user.sector.some((item) => !sectors.includes(item))
      )
        fail("授权部门或Sector无效");
      if (["owner", "lead"].includes(role) && !user.department.length)
        fail("Owner和部门负责人须有授权部门");
      if (role === "owner" && user.sector.length !== 1)
        fail("Owner须配置一条授权Sector");
      if (role === "lead" && (!user.sector.length || user.sector.length > 4))
        fail("部门负责人须配置1至4条授权Sector");
      if (role === "management" && (!user.sector.length || user.sector.length > 4))
        fail("管理层必须选择一至四条业务线");
      if (role === "management" && user.department.length) fail("管理层授权部门请留空");
      if (
        role === "admin" &&
        (user.department.length || user.sector.length)
      )
        fail("管理员的授权部门/Sector请留空；所属组织仍必填");
      if (user.history_resources?.some((item) => !resources.includes(item)))
        fail("历史费用权限包含未知资源大类");
      if (seen.has(user.email)) fail("文件中登录邮箱重复");
      seen.add(user.email);
      if (errors.length === before) {
        items.push(user);
        rowNumbers.push(rowNumber);
      }
    } else {
      const [
        id,
        name,
        sector,
        department,
        resourceType,
        owner,
        budgetText,
        active,
        reason,
      ] = cells;
      const budget = Number(budgetText),
        numericId = id ? Number(id) : undefined;
      if (id && (!Number.isSafeInteger(numericId) || numericId <= 0))
        fail("项目ID须保留模板中的数字ID；新增项目留空");
      if (
        id &&
        !(context.initiatives || []).some((item) => String(item.id) === id)
      )
        fail("项目ID不属于当前规划版本");
      if (!name || !email(owner)) fail("Initiative名称与有效Owner邮箱必填");
      if (
        !sectors.includes(sector) ||
        !departments.includes(department) ||
        !resources.includes(resourceType)
      )
        fail("Sector、部门或资源大类无效");
      if (!budgetText || !Number.isSafeInteger(budget) || budget < 0)
        fail("预算须为非负整数元");
      if (!validEnabled(active)) fail("启用列须填启用/停用");
      if (!reason || reason.length > 160) fail("变化原因必填且不超过160字");
      const key = id || `${sector}|${department}|${resourceType}|${name}`;
      if (seen.has(key)) fail("文件中项目重复");
      seen.add(key);
      if (errors.length === before) {
        rowNumbers.push(rowNumber);
        items.push({
          ...(id ? { id: numericId } : {}),
          name,
          sector,
          department,
          resourceType,
          ownerId: owner.toLowerCase(),
          budget,
          enabled: enabled(active),
          reason,
        });
      }
    }
  }
  if (rows.length > 5000)
    errors.push({ row: 0, message: "单次最多导入5000行" });
  if (!items.length && !errors.length)
    errors.push({ row: 0, message: "模板中没有可导入的数据" });
  return {
    items,
    rowNumbers,
    errors,
    total: rows.filter((row) => row.cells.some(Boolean)).length,
  };
}
export async function exportWorkbook(kind, context = {}) {
  const definition = definitions[kind];
  if (!definition) throw Error("不支持的管理员模板");
  const book = new (await excelLibrary()).Workbook();
  const metadata = book.addWorksheet("模板信息", { state: "hidden" });
  metadata.addRows([
    ["format", "resource-studio-admin-v1"],
    ["kind", kind],
    [
      "versionId",
      kind === "initiatives" ? String(context.versionId || "") : "",
    ],
  ]);
  const sheet = book.addWorksheet(definition.sheet);
  sheet.addRow(definition.headers);
  if (kind === "initiatives")
    for (const item of context.initiatives || [])
      sheet.addRow([
        item.id,
        item.name,
        item.sector,
        item.department,
        item.resourceType,
        item.ownerId,
        Number(item.budget),
        item.enabled === false ? "停用" : "启用",
        "",
      ]);
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.columns.forEach((column) => {
    column.width = 24;
  });
  sheet.getRow(1).font = { bold: true };
  const help = book.addWorksheet("填写说明");
  help.addRows([
    ["说明", "内容"],
    [
      "导入方式",
      "上传后先校验并预览；确认后整批写入，任一行失败整批不写。未列出的现有记录保持不变。",
    ],
    [
      "当前版本",
      kind === "initiatives"
        ? context.versionId || "未选择"
        : "用户信息为全局配置",
    ],
    [
      "匹配规则",
      kind === "users"
        ? "按登录邮箱匹配更新；不存在则新增。不支持改邮箱/删除。"
        : "已有项目请保留模板中的项目标识；新增留空。请删除无需更新的行，修改行填写变化原因。",
    ],
    ["部门", departments.join("、")],
    ["Sector", sectors.join("、")],
    ["资源大类", resources.join("、")],
    [
      "角色",
      "owner=Initiative Owner；lead=部门负责人；management=最高管理层；admin=系统管理员",
    ],
    [
      "授权范围",
      "多值用英文逗号分隔。Owner需一条Sector；部门负责人需1至4条Sector。Owner范围必须被部门负责人覆盖。",
    ],
    [
      "所属组织",
      "所有角色必填所属Sector和所属部门，与授权范围独立；管理员授权范围两列留空；管理层授权部门留空，授权Sector必填1–4条。",
    ],
    [
      "历史费用权限",
      "默认/空白=按所属部门；无=不显示费用明细；或填写资源大类（逗号分隔），不能超出所属部门上限。",
    ],
    [
      "已有项目用户",
      "已有Initiative的用户不能通过导入修改姓名、邮箱、角色、启用状态或Sector；仅允许符合既有项目约束的授权部门、所属组织与费用权限调整。",
    ],
    ["预算", "非负整数元，不能填万元或小数。不导入经销商分配明细。"],
    [
      "示例（仅说明，不导入）",
      kind === "users"
        ? "owner.demo@example.test | 示例Owner | owner | MKT | PCMO | 启用 | PCMO | MKT | 默认"
        : "留空ID | 示例项目 | PCMO | MKT | MRD | owner.demo@example.test | 100000 | 启用 | 年度新增",
    ],
  ]);
  help.getColumn(1).width = 24;
  help.getColumn(2).width = 110;
  help.getColumn(2).alignment = { wrapText: true, vertical: "top" };
  return book.xlsx.writeBuffer();
}
export async function previewImport(buffer, kind, context = {}) {
  const book = new (await excelLibrary()).Workbook();
  await book.xlsx.load(buffer);
  const definition = definitions[kind],
    sheet = book.getWorksheet(definition.sheet);
  const metadata = book.getWorksheet("模板信息");
  if (
    !metadata ||
    safeString(metadata.getCell("B1")) !== "resource-studio-admin-v1" ||
    safeString(metadata.getCell("B2")) !== kind
  )
    throw Error("模板标识不匹配，请重新下载对应模板。");
  if (
    kind === "initiatives" &&
    (!context.versionId ||
      safeString(metadata.getCell("B3")) !== String(context.versionId))
  )
    throw Error(
      "模板所属规划版本与当前版本不一致，请切换到对应版本或重新下载模板。",
    );
  if (!sheet) throw Error(`缺少“${definition.sheet}”工作表，请下载对应模板`);
  if (sheet.rowCount > 5001) throw Error("单次最多导入5000行");
  if (
    definition.headers.some(
      (header, index) =>
        safeString(sheet.getRow(1).getCell(index + 1)) !== header,
    )
  )
    throw Error("模板表头不匹配，请使用下载的模板并保留列顺序");
  const rows = [],
    errors = [];
  for (let n = 2; n <= sheet.rowCount; n++) {
    try {
      rows.push({
        rowNumber: n,
        cells: definition.headers.map((_, i) =>
          safeString(sheet.getRow(n).getCell(i + 1)),
        ),
      });
    } catch (error) {
      errors.push({ row: n, message: error.message });
    }
  }
  const preview = parseAdminRows(kind, rows, context);
  return { ...preview, errors: [...errors, ...preview.errors] };
}
export default { exportWorkbook, previewImport };
