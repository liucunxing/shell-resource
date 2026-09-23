import E from "./engine.js";
("use strict");
const esc = (v) =>
  String(v == null ? "" : v).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
const num = (v) =>
  Number(v || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const sum = (items) =>
  items.reduce(
    (n, i) => n + (i.rows || []).reduce((a, r) => a + E.cents(r.amount), 0),
    0,
  ) / 100;
function scope(state, identity) {
  const view = E.selectView(state, identity);
  const items = view.initiatives;
  const deps = Object.values(view.departments);
  const published = deps.filter(
    (d) =>
      Number(d.publishedCount) > 0 ||
      d.latestPublishedVersionId ||
      d.latestVersionId ||
      d.activeVersionId ||
      d.snapshot,
  ).length;
  const basisLabel =
    identity.role === "management"
      ? `各部门最新发布版本 · ${published}/3 部门已发布`
      : identity.role === "admin"
        ? "当前预算配置 · 2027 规划"
        : "当前工作方案 · 2027 规划";
  return {
    items,
    basisLabel,
    scopeLabel:
      identity.role === "management"
        ? "全公司最新发布范围"
        : identity.role === "admin"
          ? "全公司预算配置"
          : identity.role === "owner"
            ? `${identity.department} / ${identity.ownerId} 本人方案`
            : identity.department + " 本部门",
    coverage: {
      published,
      total: identity.role === "management" ? 3 : deps.length,
    },
  };
}
function dimensions(identity) {
  return identity.role === "management"
    ? ["initiative", "sector", "department"]
    : ["initiative", "sector"];
}
function analytics(state, identity, dimension = "sector") {
  if (!identity || !["lead", "management"].includes(identity.role))
    throw Error("当前角色无权查看分配分析。");
  const s = scope(state, identity),
    availableDimensions = dimensions(identity);
  if (!availableDimensions.includes(dimension))
    throw Error("无权查看该分析维度。");
  const groups = new Map();
  s.items.forEach((i) => {
    const id =
      dimension === "initiative" ? i.id : String(i[dimension] || "未分类");
    if (!groups.has(id))
      groups.set(id, {
        id,
        label:
          dimension === "initiative"
            ? `${i.name} · ${i.sector} / ${i.resourceType} · ${i.id}`
            : id,
        amount: 0,
        initiativeIds: [],
      });
    const row = groups.get(id);
    row.amount += E.cents(sum([i]));
    row.initiativeIds.push(i.id);
  });
  const total = sum(s.items),
    rows = [...groups.values()]
      .map((r) => ({
        ...r,
        amount: r.amount / 100,
        share: total ? r.amount / 100 / total : 0,
      }))
      .sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));
  return {
    ...s,
    items: undefined,
    dimension,
    availableDimensions,
    rows,
    total,
    emptyMessage: total ? "" : "当前范围尚无经销商分配金额。",
  };
}
function groupDetail(state, identity, dimension, id) {
  const model = analytics(state, identity, dimension),
    group = model.rows.find((r) => r.id === id);
  if (!group) throw Error("该分组不存在或不在权限范围。");
  const allowed = new Set(group.initiativeIds);
  return scope(state, identity)
    .items.filter((i) => allowed.has(i.id))
    .map((i) => ({
      id: i.id,
      name: i.name,
      department: i.department,
      sector: i.sector,
      resourceType: i.resourceType,
      budget: i.budget,
      allocated: sum([i]),
    }));
}
const dimensionLabels = {
  initiative: "Initiative",
  sector: "Sector",
  department: "部门",
};
function renderAnalytics(model, options = {}) {
  const dimension = options.dimension || model.dimension || "sector",
    top = model.rows.slice(0, 10);
  return `<section class="panel analytics-panel"><div class="panel-head"><div><h2>分配结构</h2><p>${esc(model.scopeLabel)} · ${esc(model.basisLabel)}</p></div><div class="toolbar">${model.availableDimensions.map((d) => `<button class="button ${dimension === d ? "primary" : ""}" data-action="chart-dimension" data-dimension="${d}" aria-pressed="${dimension === d}">${dimensionLabels[d]}</button>`).join("")}</div></div><div class="analytics-summary"><strong>${num(model.total)}</strong><span>经销商实际分配合计 · 占比分母为当前可见范围全部经销商分配，不含预留与非经销商安排</span></div>${model.emptyMessage ? `<div class="empty">${esc(model.emptyMessage)}</div>` : `<div class="analytics-bars" role="list" aria-label="分配金额占比">${top.map((r) => `<button role="listitem" class="analytics-bar-row" data-action="chart-select" data-id="${esc(r.id)}"><span class="analytics-bar-label">${esc(r.label)}</span><span class="analytics-bar-track"><span class="analytics-bar-fill" style="display:block;width:${Math.max(0, Math.min(100, r.share * 100))}%;height:100%;background:var(--accent,#c49b36)"></span></span><span class="analytics-bar-value">${num(r.amount)} <strong>${(r.share * 100).toFixed(1)}%</strong></span></button>`).join("")}</div>${model.rows.length > 10 ? '<p class="muted">图表仅展示金额前 10 项；百分比分母仍为全量分配，因此图中占比不一定合计 100%。下方列出全部项目。</p>' : ""}<details class="analytics-ranking"><summary>全部排行 · ${model.rows.length} 项</summary><div class="table-scroll"><table><thead><tr><th>分组</th><th>分配金额</th><th>占比</th><th>Initiative 数</th></tr></thead><tbody>${model.rows.map((r) => `<tr><td><button class="button" data-action="chart-select" data-id="${esc(r.id)}">${esc(r.label)}</button></td><td>${num(r.amount)}</td><td>${(r.share * 100).toFixed(1)}%</td><td>${r.initiativeIds.length}</td></tr>`).join("")}</tbody></table></div></details>`}</section>`;
}
const cols = (entries) => entries.map(([key, label]) => ({ key, label }));
const legacyReasons = {
  reserve: "新增经销商预留",
  unallocated: "无法分配到经销商",
  other: "其他支出",
};
function otherBudgetRows(item) {
  if (Array.isArray(item.otherBudgets))
    return item.otherBudgets.map((r) => ({
      id: r.id,
      reasonId: r.reasonId,
      amount: r.amount,
      note: r.note || "",
    }));
  const rows = [];
  if (Number(item.reserve) > 0)
    rows.push({
      id: "legacy-reserve",
      reasonId: "reserve",
      amount: item.reserve,
      note: item.reserveNote || "",
    });
  if (Number(item.nonDealer) > 0)
    rows.push({
      id: "legacy-non-dealer",
      reasonId: "other",
      amount: item.nonDealer,
      note: item.nonDealerNote || "",
    });
  return rows;
}
function reasonLabel(state, reasonId) {
  const reasons = Array.isArray(state.budgetReasons) ? state.budgetReasons : [];
  const found = reasons.find((r) => r && r.id === reasonId);
  return found
    ? found.label || found.name || found.id
    : legacyReasons[reasonId] || String(reasonId || "");
}
function rawData(state, identity, data, tab) {
  const s = scope(state, identity),
    admin = identity.role === "admin";
  tab = tab || (admin ? "budgets" : "allocations");
  const tabs = (
    admin
      ? [
          ["budgets", "预算配置"],
          ["history", "历史数据"],
        ]
      : [
          ["allocations", "分配明细"],
          ["budgets", "预算明细"],
          ["other-budgets", "其他预算明细"],
          ["history", "历史数据"],
        ]
  ).map(([id, label]) => ({ id, label }));
  if (!tabs.some((t) => t.id === tab))
    throw Error("当前角色无权查看该数据表。");
  const model = {
    title: "原始数据",
    tab,
    scopeLabel: s.scopeLabel,
    basisLabel: s.basisLabel,
    tabs,
    columns: [],
    rows: [],
    notes: ["只读演示数据；金额单位未在源表标注，按原数值展示。"],
    allowExport: true,
  };
  const common = [
    ["initiativeId", "Initiative ID"],
    ["initiative", "Initiative"],
    ["department", "部门"],
    ["ownerId", "Owner"],
    ["sector", "Sector"],
    ["resourceType", "资源类型"],
  ];
  const base = (i) => ({
    initiativeId: i.id,
    initiative: i.name,
    department: i.department,
    ownerId: i.ownerId,
    sector: i.sector,
    resourceType: i.resourceType,
  });
  if (tab === "allocations") {
    model.columns = cols([
      ...common,
      ["dealerId", "经销商 ID"],
      ["amount", "分配金额"],
      ["note", "业务说明"],
    ]);
    model.rows = s.items.flatMap((i) =>
      (i.rows || []).map((r) => ({
        ...base(i),
        dealerId: r.dealerId,
        amount: r.amount,
        note: r.note || "",
      })),
    );
    model.notes.push("仅经销商分配明细；预留与非经销商安排见预算明细。");
  } else if (tab === "budgets") {
    model.columns = cols([
      ...common,
      ["budget", "预算"],
      ...(!admin
        ? [
            ["allocated", "已分配到经销商"],
            ["otherBudgetTotal", "其他预算合计"],
          ]
        : []),
    ]);
    model.rows = s.items.map((i) => ({
      ...base(i),
      budget: i.budget,
      ...(!admin
        ? {
            allocated: sum([i]),
            otherBudgetTotal: otherBudgetRows(i).reduce(
              (total, row) => total + Number(row.amount || 0),
              0,
            ),
          }
        : {}),
    }));
  } else if (tab === "other-budgets") {
    model.columns = cols([
      ...common,
      ["otherBudgetReason", "其他预算原因"],
      ["otherBudgetAmount", "其他预算金额"],
      ["otherBudgetNote", "原因说明"],
    ]);
    model.rows = s.items.flatMap((i) =>
      otherBudgetRows(i).map((row) => ({
        ...base(i),
        otherBudgetReason: reasonLabel(state, row.reasonId),
        otherBudgetAmount: row.amount,
        otherBudgetNote: row.note || "",
      })),
    );
    model.notes.push("每一行对应一条其他预算安排；同一 Initiative 可有多条。");
  } else {
    const all = ["management", "admin"].includes(identity.role);
    const resources = all
      ? ["MRD", "SP&A", "ICE Rebate", "Capex"]
      : identity.department === "MKT"
        ? ["MRD", "SP&A"]
        : identity.department === "ICE"
          ? ["ICE Rebate"]
          : ["Capex"];
    const history = [
      ["vol2024", "2024 Vol"],
      ["c32024", "2024 C3"],
      ["vol2025", "2025 Vol"],
      ["c32025", "2025 C3"],
      ["vol2026Ytd", "2026 1–8月 Vol"],
      ["c32026Ytd", "2026 1–8月 C3"],
    ];
    model.columns = cols([
      ["dealerId", "经销商 ID"],
      ...history,
      ...resources.map((r) => ["resource_" + r, "2025 " + r]),
      ["yield2025", "2025 C3 / 2025 资源"],
      ...(all
        ? [
            ["resource2025", "2025 资源总额"],
            ["resourcePerLiter2025", "2025 资源 / 2025 Vol"],
          ]
        : []),
    ]);
    model.rows = data.dealers.map((d) => {
      const h = d.history || {},
        row = { dealerId: d.id };
      history.forEach(([k]) => (row[k] = h[k]));
      resources.forEach(
        (r) => (row["resource_" + r] = (h.resources2025 || {})[r]),
      );
      const ratio = state.scenario === "api" && Number.isFinite(h.yield2025)
        ? h.yield2025
        : Number.isFinite(h.c32025) &&
        Number.isFinite(h.resource2025) &&
        h.resource2025 > 0
          ? h.c32025 / h.resource2025
          : null;
      row.yield2025 = Number.isFinite(ratio) ? ratio : null;
      if (all) {
        row.resource2025 = h.resource2025;
        row.resourcePerLiter2025 = h.resourcePerLiter2025;
      }
      return row;
    });
    model.scopeLabel = `共享经销商 Vol / C3 · ${all ? "全资源" : identity.department + " 授权资源"}`;
    model.basisLabel = "源历史数据 · 全部 60 家经销商（模拟）";
    model.notes.push(
      "2024、2025 为全年；2026 为 1–8 月累计，不默认同比或年化。",
      "整体 Yield 向所有角色只读开放，按 2025 C3 / 2025 总资源重新计算；分母无效时留空，不代表投入因果回报。",
      all
        ? "全资源历史仅供只读参考。"
        : "资源明细仅显示本部门授权范围；整体 Yield 为授权共享指标，不额外展示跨部门资源总额或资源明细。",
    );
  }
  return model;
}
function historyReference(state, identity, data, dealerId) {
  const model = rawData(state, identity, data, "history");
  const row = model.rows.find((r) => String(r.dealerId) === String(dealerId));
  if (!row) throw Error("经销商不存在或不在历史数据权限范围。");
  return {
    dealerId: row.dealerId,
    scopeLabel: model.scopeLabel,
    yield2025: row.yield2025,
    periods: [
      {
        label: "2024 全年",
        vol: row.vol2024,
        c3: row.c32024,
        comparable: true,
      },
      {
        label: "2025 全年",
        vol: row.vol2025,
        c3: row.c32025,
        comparable: true,
      },
      {
        label: "2026 1–8月",
        vol: row.vol2026Ytd,
        c3: row.c32026Ytd,
        comparable: false,
      },
    ],
    resources: model.columns
      .filter((c) => c.key.startsWith("resource_"))
      .map((c) => ({ label: c.label, amount: row[c.key] })),
    allResources: ["management", "admin"].includes(identity.role),
  };
}
function filterRows(model, search = "") {
  const q = String(search).trim().toLocaleLowerCase();
  return q
    ? model.rows.filter((r) =>
        model.columns.some((c) =>
          String(r[c.key] ?? "")
            .toLocaleLowerCase()
            .includes(q),
        ),
      )
    : model.rows.slice();
}
function csv(model, search = "") {
  const quote = (v) => {
    let value = String(v ?? "");
    if (/^[\s\u0000-\u001f]*[=+\-@]/.test(value)) value = "'" + value;
    return '"' + value.replace(/"/g, '""') + '"';
  };
  return (
    "\ufeff" +
    [
      model.columns.map((c) => quote(c.label)).join(","),
      ...filterRows(model, search).map((r) =>
        model.columns.map((c) => quote(r[c.key])).join(","),
      ),
    ].join("\r\n")
  );
}
function renderRaw(model, { search = "", page = 1, pageSize = 15 } = {}) {
  const rows = filterRows(model, search),
    size = Math.max(1, Math.min(100, Math.floor(Number(pageSize) || 15))),
    pages = Math.max(1, Math.ceil(rows.length / size));
  page = Math.max(1, Math.min(pages, Math.floor(Number(page) || 1)));
  return `<section class="panel raw-panel"><div class="panel-head"><div><h2>${esc(model.title)}</h2><p>${esc(model.scopeLabel)} · ${esc(model.basisLabel)}</p></div><button class="button" data-action="raw-export">导出当前筛选 CSV</button></div><div class="toolbar">${model.tabs.map((t) => `<button class="button ${t.id === model.tab ? "primary" : ""}" data-action="raw-tab" data-tab="${t.id}" aria-pressed="${t.id === model.tab}">${esc(t.label)}</button>`).join("")}<label>搜索 <input id="raw-search" type="search" value="${esc(search)}" placeholder="搜索当前权限内的数据" /></label></div><div class="table-scroll"><table><thead><tr>${model.columns.map((c) => `<th>${esc(c.label)}</th>`).join("")}</tr></thead><tbody>${
    rows
      .slice((page - 1) * size, page * size)
      .map(
        (r) =>
          `<tr>${model.columns.map((c) => `<td>${typeof r[c.key] === "number" ? num(r[c.key]) : esc(r[c.key])}</td>`).join("")}</tr>`,
      )
      .join("") ||
    `<tr><td colspan="${model.columns.length}">暂无匹配数据</td></tr>`
  }</tbody></table></div><div class="toolbar raw-pagination"><span>共 ${rows.length} 行 · 第 ${page} / ${pages} 页</span><button class="button" data-action="raw-page" data-page="${page - 1}" ${page === 1 ? "disabled" : ""}>上一页</button><button class="button" data-action="raw-page" data-page="${page + 1}" ${page === pages ? "disabled" : ""}>下一页</button></div><div class="raw-notes">${model.notes.map((n) => `<p class="muted">${esc(n)}</p>`).join("")}</div></section>`;
}
export default {
  analytics,
  groupDetail,
  renderAnalytics,
  rawData,
  historyReference,
  renderRaw,
  filterRows,
  csv,
};
