"use strict";
const departments = (value) => {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value.department : value;
  return [...new Set((Array.isArray(raw) ? raw : raw ? [raw] : []).filter((v) => typeof v === "string" && v.trim()).map((v) => v.trim().toUpperCase()))];
};
const hasDepartment = (identity, department) => departments(identity).includes(department);
const DEPARTMENTS = ["MKT", "ICE", "CAPEX"];
const RESOURCE_DEPARTMENT = {
  MRD: "MKT",
  "SP&A": "MKT",
  "ICE Rebate": "ICE",
  Capex: "CAPEX",
};
const DEFAULT_BUDGET_REASONS = [
  { id: "reserve", label: "新增经销商预留", enabled: true },
  { id: "unallocated", label: "无法分配到经销商", enabled: true },
  { id: "other", label: "其他支出", enabled: true },
];
const clone = (value) => JSON.parse(JSON.stringify(value));
const now = () => new Date().toISOString();
let serial = 0;
const uid = (prefix) =>
  prefix + "-" + Date.now().toString(36) + "-" + (++serial).toString(36);
const fail = (message) => {
  throw new Error(message);
};
const cents = (value) => Math.round(Number(value) * 100);
const money = (value) => value / 100;
const validMoney = (value) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  Number.isSafeInteger(Math.round(value * 100)) &&
  Math.abs(value * 100 - Math.round(value * 100)) < 0.000001;
const hasText = (value) => typeof value === "string" && value.trim().length > 0;
function identityCheck(identity) {
  if (
    !identity ||
    !["owner", "lead", "management", "admin"].includes(identity.role)
  )
    fail("身份无效，请选择演示角色。");
  if (
    ["owner", "lead"].includes(identity.role) &&
    (!departments(identity).length || (!identity.apiMode && departments(identity).some((dep) => !DEPARTMENTS.includes(dep))))
  )
    fail("部门身份无效。");
  if (
    identity.role === "owner" &&
    (!hasText(identity.ownerId) ||
      (!identity.apiMode &&
        !departments(identity).flatMap((dep) => [dep + "-1", dep + "-2"]).includes(
          identity.ownerId,
        )))
  )
    fail("Owner 身份无效。");
}
function role(identity, expected) {
  identityCheck(identity);
  if (identity.role !== expected) fail("当前角色无权执行此操作。");
}
function department(state, dep) {
  if (!state.departments[dep])
    fail("部门不存在。");
  return state.departments[dep];
}
function initiative(state, id) {
  const item = state.initiatives.find((i) => i.id === id);
  if (!item) fail("Initiative 不存在。");
  return item;
}
function unlocked(state, dep) {
  // Publishing is a read model, not an approval lock.  A legacy final marker
  // is retained as an archive only and never prevents the next revision.
  department(state, dep);
  return true;
}
function requireUnlocked(state, dep) {
  if (!unlocked(state, dep)) fail("部门状态无效，不能修改。");
}
function audit(state, identity, action, object, detail) {
  state.audit.push({
    id: uid("AUD"),
    createdAt: now(),
    actor: clone(identity),
    action,
    object,
    detail: detail || "",
  });
}
function itemsFor(state, dep) {
  return state.initiatives.filter((i) => i.department === dep);
}
function budgetRows(i) {
  if (Array.isArray(i.otherBudgets)) return i.otherBudgets;
  const rows = [];
  if (Number(i.reserve) || hasText(i.reserveNote))
    rows.push({
      id: "legacy-reserve",
      reasonId: "reserve",
      amount: Number(i.reserve) || 0,
      note: i.reserveNote || "",
    });
  if (Number(i.nonDealer) || hasText(i.nonDealerNote))
    rows.push({
      id: "legacy-other",
      reasonId: "other",
      amount: Number(i.nonDealer) || 0,
      note: i.nonDealerNote || "",
    });
  return rows;
}
function syncBudgetCompatibility(i) {
  const rows = budgetRows(i);
  i.otherBudgets = rows;
  const forReason = (id) => rows.filter((r) => r.reasonId === id);
  const amount = (id) =>
    money(forReason(id).reduce((n, r) => n + cents(r.amount || 0), 0));
  const notes = (id) =>
    forReason(id)
      .map((r) => r.note || "")
      .filter(Boolean)
      .join("；");
  i.reserve = amount("reserve");
  i.reserveNote = notes("reserve");
  i.nonDealer = money(
    ["unallocated", "other"].reduce((n, id) => n + cents(amount(id)), 0),
  );
  i.nonDealerNote = [notes("unallocated"), notes("other")]
    .filter(Boolean)
    .join("；");
  return i;
}
function totals(items) {
  const byReason = new Map();
  const sum = (items || []).reduce(
    (out, i) => {
      out.budget += cents(i.budget || 0);
      out.allocated += (i.rows || []).reduce(
        (n, r) => n + cents(r.amount || 0),
        0,
      );
      budgetRows(i).forEach((row) => {
        const value = cents(row.amount || 0);
        byReason.set(row.reasonId, (byReason.get(row.reasonId) || 0) + value);
        out.otherBudget += value;
        if (row.reasonId === "reserve") out.reserve += value;
        else out.nonDealer += value;
        if (row.reasonId === "other") out.other += value;
      });
      return out;
    },
    {
      budget: 0,
      allocated: 0,
      reserve: 0,
      nonDealer: 0,
      other: 0,
      otherBudget: 0,
    },
  );
  sum.gap = sum.budget - sum.allocated - sum.otherBudget;
  const result = Object.fromEntries(
    Object.entries(sum).map(([k, v]) => [k, money(v)]),
  );
  result.otherBudgetByReason = Array.from(byReason, ([reasonId, amount]) => ({
    reasonId,
    amount: money(amount),
  })).sort((a, b) => String(a.reasonId).localeCompare(String(b.reasonId)));
  return result;
}
function validateInitiative(i, data, reasons) {
  const errors = [];
  for (const key of ["budget"]) {
    if (!validMoney(i[key]))
      errors.push(
        {
          budget: "预算",
        }[key] + "须为非负有限金额，最多两位小数。",
      );
  }
  if (!Array.isArray(i.otherBudgets)) errors.push("其他预算安排必须是数组。");
  else {
    const reasonIds = new Set(
      (reasons || i._budgetReasons || DEFAULT_BUDGET_REASONS).map((r) => r.id),
    );
    const rowIds = new Set();
    i.otherBudgets.forEach((row, index) => {
      const prefix = "第 " + (index + 1) + " 行其他预算";
      if (!row || !hasText(row.id)) errors.push(prefix + "缺少编号。");
      else if (rowIds.has(row.id)) errors.push(prefix + "编号重复。");
      else rowIds.add(row.id);
      if (!row || !reasonIds.has(row.reasonId))
        errors.push(prefix + "原因不存在。");
      if (!row || !validMoney(row.amount))
        errors.push(prefix + "金额须为非负有限金额，最多两位小数。");
      if (row && typeof row.note !== "string")
        errors.push(prefix + "原因说明必须是文字。");
    });
  }
  const directoryDealers =
    data && Object.hasOwn(data, "distributorDirectory")
      ? data.distributorDirectory
      : data?.dealers;
  const ids = new Set((directoryDealers || [])
    .filter((dealer) => !i.sector || !dealer.sector || dealer.sector === i.sector)
    .filter((dealer) => dealer.status == null || dealer.status === "active" || String(dealer.status) === "1")
    .map((dealer) => String(dealer.id)));
  // Preserve source allocations when a dealer later closes; only new choices
  // must come from the active directory. The API enforces the same rule.
  const saved = data?.initiatives?.find((item) => String(item.id) === String(i.id));
  for (const row of saved?.rows || []) ids.add(String(row.dealerId));
  const seen = new Set();
  if (!Array.isArray(i.rows)) errors.push("分配明细必须是数组。");
  else
    i.rows.forEach((r, index) => {
      if (!r || !ids.has(String(r.dealerId)))
        errors.push("第 " + (index + 1) + " 行经销商不存在。");
      if (r && seen.has(r.dealerId))
        errors.push("第 " + (index + 1) + " 行经销商重复。");
      if (r) seen.add(r.dealerId);
      if (!r || !validMoney(r.amount))
        errors.push(
          "第 " + (index + 1) + " 行金额须为非负有限金额，最多两位小数。",
        );
      if (r && r.note != null && typeof r.note !== "string")
        errors.push("第 " + (index + 1) + " 行说明必须是文字。");
    });
  return errors;
}
function completionErrors(i, data, reasons) {
  const errors = validateInitiative(i, data, reasons);
  if (!errors.length && cents(totals([i]).gap) !== 0)
    errors.push(cents(totals([i]).gap) < 0
      ? "预留金额与已分配金额合计超过项目总预算，请修正后继续。"
      : "预算未平衡，请处理未解释差额后标记完成。");
  if (!errors.length && Array.isArray(i.otherBudgets))
    i.otherBudgets.forEach((row, index) => {
      if (i.workflow && !(reasons || DEFAULT_BUDGET_REASONS).some((reason) => reason.id === row.reasonId && reason.enabled))
        errors.push("第 " + (index + 1) + " 行预留原因已停用或不存在，请重新选择。");
      if (!i.workflow && row.amount > 0 && !hasText(row.note))
        errors.push("第 " + (index + 1) + " 行其他预算须填写原因说明。");
    });
  return errors;
}
function canEdit(state, id, identity) {
  if (identity?.preview?.readOnly) return false;
  try {
    identityCheck(identity);
    const i = initiative(state, id);
    if (i.workflow && !i.workflow.editable) return false;
    return (
      ["owner", "lead"].includes(identity.role) &&
      hasDepartment(identity, i.department) &&
      Boolean(identity.ownerId) && String(i.ownerId || "").toLowerCase() === String(identity.ownerId).toLowerCase() &&
      unlocked(state, i.department)
    );
  } catch (_) {
    return false;
  }
}
function requireOwner(state, id, identity) {
  if (!canEdit(state, id, identity))
    fail("仅当前 Initiative 的 Owner 可编辑。");
  return initiative(state, id);
}
function changed(i) {
  i.revision += 1;
  i.status = "editing";
  i.savedAt = now();
}
function updateInitiative(state, id, patch, identity, data) {
  migrateState(state);
  const i = requireOwner(state, id, identity);
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    fail("编辑内容无效。");
  const allowed = [
    "rows",
    "otherBudgets",
    "reserve",
    "reserveNote",
    "nonDealer",
    "nonDealerNote",
    "changeReason",
    "editorState",
  ];
  if (Object.keys(patch).some((k) => !allowed.includes(k)))
    fail("Owner 只能调整分配及用途说明，预算和归属由管理员维护。");
  if (Object.prototype.hasOwnProperty.call(patch, "changeReason") &&
      (typeof patch.changeReason !== "string" || patch.changeReason.length > 160))
    fail("调整依据说明须为不超过160字的文本。");
  // Legacy callers can still provide the two old pools; normalize them into
  // the canonical row model before validating or storing the change.
  const normalized = clone(patch);
  if (
    ["reserve", "reserveNote", "nonDealer", "nonDealerNote"].some((k) =>
      Object.prototype.hasOwnProperty.call(normalized, k),
    )
  ) {
    const rows = clone(i.otherBudgets || []);
    const replace = (reasonId, amountKey, noteKey) => {
      const index = rows.findIndex((row) => row.reasonId === reasonId);
      const previous =
        index >= 0
          ? rows[index]
          : { id: uid("OB"), reasonId, amount: 0, note: "" };
      const next = Object.assign({}, previous);
      if (Object.prototype.hasOwnProperty.call(normalized, amountKey))
        next.amount = normalized[amountKey];
      if (Object.prototype.hasOwnProperty.call(normalized, noteKey))
        next.note = normalized[noteKey];
      if (index >= 0) rows[index] = next;
      else rows.push(next);
    };
    replace("reserve", "reserve", "reserveNote");
    replace("other", "nonDealer", "nonDealerNote");
    normalized.otherBudgets = rows;
    ["reserve", "reserveNote", "nonDealer", "nonDealerNote"].forEach(
      (k) => delete normalized[k],
    );
  }
  const candidate = Object.assign({}, i, normalized, {
    _budgetReasons: state.budgetReasons,
  });
  const errors = validateInitiative(candidate, data);
  if (errors.length) fail(errors.join("\n"));
  Object.assign(i, clone(normalized));
  syncBudgetCompatibility(i);
  const allocationChanged = Object.keys(patch).some((key) => key !== "editorState");
  if (allocationChanged) changed(i);
  audit(state, identity, "save_initiative", id,
    allocationChanged ? "草稿保存，完成标记已取消。" : "更新草稿步骤与预算预留核对状态。");
  return i;
}
function complete(state, id, identity, data) {
  migrateState(state);
  const i = requireOwner(state, id, identity);
  const errors = completionErrors(i, data, state.budgetReasons);
  if (errors.length) fail(errors.join("\n"));
  i.status = "completed";
  i.savedAt = now();
  audit(state, identity, "complete_initiative", id);
  return i;
}
function balanceOtherBudget(state, id, identity, data) {
  migrateState(state);
  const i = requireOwner(state, id, identity);
  const gapCents = cents(totals([i]).gap);
  if (gapCents === 0)
    return { changed: false, delta: 0, rowId: null, reasonId: "unallocated" };
  const rowId = "OB-BALANCE-" + i.id;
  const rows = clone(i.otherBudgets || []);
  const index = rows.findIndex((row) => row.id === rowId);
  let row = index >= 0 ? rows[index] : null;
  if (row && row.reasonId !== "unallocated")
    fail("专用余额行已被人工调整，不能自动覆盖。");
  if (
    gapCents > 0 &&
    !state.budgetReasons.some(
      (reason) => reason.id === "unallocated" && reason.enabled,
    )
  )
    fail("“无法分配到经销商”原因未启用，不能自动平衡预算。");
  if (gapCents < 0 && (!row || cents(row.amount) < -gapCents))
    fail("超出预算且专用未分配余额不足，不能自动减少人工预算行。");
  if (!row) {
    row = {
      id: rowId,
      reasonId: "unallocated",
      amount: 0,
      note: "未分配至经销商的剩余预算，待后续落实",
    };
    rows.push(row);
  }
  row.amount = money(cents(row.amount) + gapCents);
  if (!hasText(row.note)) row.note = "未分配至经销商的剩余预算，待后续落实";
  const candidate = Object.assign({}, i, { otherBudgets: rows });
  const errors = validateInitiative(candidate, data, state.budgetReasons);
  if (errors.length) fail(errors.join("\n"));
  i.otherBudgets = rows;
  syncBudgetCompatibility(i);
  changed(i);
  audit(
    state,
    identity,
    "balance_other_budget",
    i.id,
    "自动将未解释差额 " + money(gapCents) + " 计入专用未分配预算行。",
  );
  return {
    changed: true,
    delta: money(gapCents),
    rowId,
    reasonId: "unallocated",
  };
}
function reopen(state, id, identity) {
  const i = requireOwner(state, id, identity);
  changed(i);
  audit(state, identity, "reopen_initiative", id);
  return i;
}
function snapshotInternal(state, dep, versionId) {
  const d = department(state, dep);
  const snapshot = d.versions.find(
    (v) => v.id === (versionId || d.activeVersionId),
  );
  return snapshot ? clone(snapshot) : null;
}
function migrateState(state) {
  if (!state || !Array.isArray(state.initiatives) || !state.departments)
    fail("工作台状态不完整。");
  // Discard retired local analysis caches without changing allocation snapshots.
  delete state.insights;
  delete state.analysisPrompts;
  const configured = Array.isArray(state.budgetReasons)
    ? state.budgetReasons
    : [];
  const byId = new Map(configured.map((row) => [row && row.id, row]));
  DEFAULT_BUDGET_REASONS.forEach((row) => {
    if (!byId.has(row.id)) configured.push(clone(row));
  });
  state.budgetReasons = configured
    .filter((row) => row && hasText(row.id) && hasText(row.label))
    .map((row) => ({
      id: row.id.trim(),
      label: row.label.trim(),
      enabled: row.enabled !== false,
    }));
  if (
    !Number.isSafeInteger(state.budgetReasonVersion) ||
    state.budgetReasonVersion < 1
  )
    state.budgetReasonVersion = 1;
  const knownReasons = new Set(state.budgetReasons.map((row) => row.id));
  state.initiatives.forEach((i) => {
    if (!Array.isArray(i.otherBudgets)) {
      i.otherBudgets = budgetRows(i).map((row, n) =>
        Object.assign({}, row, {
          id: row.id || uid("OB"),
          reasonId: knownReasons.has(row.reasonId) ? row.reasonId : "other",
        }),
      );
    } else {
      i.otherBudgets = i.otherBudgets.map((row, n) => ({
        id: hasText(row && row.id) ? row.id : "OB-MIG-" + i.id + "-" + n,
        reasonId: knownReasons.has(row && row.reasonId)
          ? row.reasonId
          : "other",
        amount: Number(row && row.amount) || 0,
        note: row && typeof row.note === "string" ? row.note : "",
      }));
    }
    syncBudgetCompatibility(i);
  });
  state.publications =
    state.publications && typeof state.publications === "object"
      ? state.publications
      : {};
  // Convert legacy department submissions into immutable per-initiative publications.
  Object.keys(state.departments).forEach((dep) => {
    const d = state.departments[dep];
    (d.versions || []).forEach((version) =>
      (version.initiatives || []).forEach((item) => {
        const list =
          state.publications[item.id] || (state.publications[item.id] = []);
        if (
          !list.some(
            (publication) => publication.legacyVersionId === version.id,
          )
        ) {
          list.push({
            id: uid("PUB-MIG"),
            initiativeId: item.id,
            department: dep,
            number: list.length + 1,
            createdAt: version.createdAt || now(),
            publishedAt: version.createdAt || now(),
            publishedRevision: item.revision,
            initiative: clone(item),
            reference: clone(version.reference || state.reference),
            guideVersion: version.guideVersion || state.guide.version,
            legacyVersionId: version.id,
          });
        }
      }),
    );
    d.status = "collecting";
    // Keep `activeVersionId` as legacy browsing metadata; it has no locking semantics.
  });
  if (state.final) {
    state.legacyFinal = state.legacyFinal || clone(state.final);
    state.final = null;
  }
  state.schemaVersion = 2;
  return state;
}
function publicationsFor(state, id) {
  migrateState(state);
  return state.publications[id] || [];
}
function latestPublicationInternal(state, id) {
  const list = publicationsFor(state, id);
  return list.length ? clone(list[list.length - 1]) : null;
}
function latestPublication(state, id, identity) {
  identityCheck(identity);
  const item = initiative(state, id);
  if (identity.role === "owner" && item.ownerId !== identity.ownerId)
    fail("无权读取其它 Owner 的发布版本。");
  if (identity.role === "lead" && !hasDepartment(identity, item.department))
    fail("无权读取其它部门的发布版本。");
  return latestPublicationInternal(state, id);
}
function publishInitiative(state, id, identity, data, note) {
  migrateState(state);
  const i = requireOwner(state, id, identity);
  const errors = completionErrors(i, data, state.budgetReasons);
  if (errors.length) fail(errors.join("\n"));
  const list = publicationsFor(state, id);
  const record = {
    id: uid("PUB"),
    initiativeId: id,
    department: i.department,
    number: list.length + 1,
    createdAt: now(),
    publishedAt: now(),
    publishedRevision: i.revision,
    note: String(note || ""),
    initiative: clone(i),
    reference: clone(state.reference),
    guideVersion: state.guide.version,
  };
  list.push(record);
  state.publications[id] = list;
  audit(state, identity, "publish_initiative", id, record.id);
  return clone(record);
}
function latestPublishedItemsInternal(state, dep) {
  migrateState(state);
  return itemsFor(state, dep)
    .map((i) => latestPublicationInternal(state, i.id))
    .filter(Boolean)
    .map((record) =>
      Object.assign(clone(record.initiative), {
        publishedAt: record.publishedAt,
        publishedRevision: record.publishedRevision,
        publicationId: record.id,
      }),
    );
}
function latestPublishedItems(state, dep, identity) {
  identityCheck(identity);
  department(state, dep);
  if (identity.role === "admin" || identity.role === "owner")
    fail("当前角色无权读取部门发布明细。");
  if (identity.role === "lead" && !hasDepartment(identity, dep))
    fail("无权读取其它部门的发布明细。");
  return latestPublishedItemsInternal(state, dep);
}
function getSnapshot(state, dep, versionId, identity) {
  identityCheck(identity);
  if (["owner", "lead"].includes(identity.role) && !hasDepartment(identity, dep))
    fail("无权读取其它部门的提交明细。");
  const snapshot = snapshotInternal(state, dep, versionId);
  if (!snapshot) return null;
  // Old local snapshots may contain retired analysis payloads.
  delete snapshot.insight;
  delete snapshot.insightStatus;
  delete snapshot.analysisBasis;
  if (identity.role === "owner") {
    const currentlyOwnedIds = new Set(
      state.initiatives
        .filter((item) => item.ownerId === identity.ownerId)
        .map((item) => item.id),
    );
    snapshot.departmentTotals = totals(snapshot.initiatives);
    snapshot.initiatives = snapshot.initiatives.filter((i) =>
      currentlyOwnedIds.has(i.id),
    );
    // Submission notes may quote colleagues; expose only the owner’s own rows.
    delete snapshot.note;
    snapshot.visibility = "本人明细及部门汇总";
  }
  return snapshot;
}
// Presentation selectors model backend authorization. The offline demo still holds
// the complete state locally and is not a security boundary against developer tools.
function selectView(state, identity) {
  migrateState(state);
  identityCheck(identity);
  const result = {
    role: identity.role,
    initiatives: [],
    departments: {},
    summaries: {},
    reference: clone(state.reference),
    guide:
      identity.role === "owner"
        ? { version: state.guide.version }
        : clone(state.guide),
    final: state.final ? clone(state.final) : null,
  };
  const versionMeta = (v) => ({
    id: v.id,
    number: v.number,
    createdAt: v.createdAt,
  });
  const progress = (dep) => {
    const d = department(state, dep);
    return {
      status: d.status,
      activeVersionId: d.activeVersionId,
      versions: d.versions.map(versionMeta),
    };
  };
  if (identity.role === "owner" || identity.role === "lead") {
    for (const dep of departments(identity)) {
      const all = itemsFor(state, dep);
      const visible =
        identity.role === "lead"
          ? all
          : all.filter((i) => i.ownerId === identity.ownerId);
      const allowedIds = new Set(visible.map((i) => i.id));
      result.initiatives.push(...visible.map((item) => {
        const publication = latestPublicationInternal(state, item.id);
        return Object.assign(
          {},
          clone(item),
          publication
            ? {
                publishedAt: publication.publishedAt,
                publishedRevision: publication.publishedRevision,
                publicationId: publication.id,
              }
            : {},
        );
      }));
      result.summaries[dep] = Object.assign(totals(all), {
        initiativeCount: all.length,
        completedCount: all.filter((i) => i.status === "completed").length,
      });
      result.departments[dep] = Object.assign(progress(dep), {
        comments: clone(
          state.departments[dep].comments.filter(
            (c) => identity.role === "lead" || allowedIds.has(c.initiativeId),
          ),
        ),
      });
      // Final ids from other departments do not belong in an Owner/Lead view.
      result.final = state.final
        ? {
            id: state.final.id,
            createdAt: state.final.createdAt,
            departmentVersionId: state.final.departmentVersions[dep],
            departmentVersions: Object.fromEntries(departments(identity).map((d) => [d, state.final.departmentVersions[d]])),
          }
        : null;
    }
  } else if (identity.role === "management") {
    DEPARTMENTS.forEach((dep) => {
      const published = latestPublishedItemsInternal(state, dep);
      result.departments[dep] = Object.assign(progress(dep), {
        publishedCount: published.length,
        totalInitiativeCount: itemsFor(state, dep).length,
      });
      if (published.length) {
        result.initiatives.push(...clone(published));
        result.summaries[dep] = Object.assign(totals(published), {
          initiativeCount: published.length,
          completedCount: published.length,
        });
      }
    });
    result.managementReadOnly = true;
  } else {
    result.initiatives = clone(state.initiatives);
    DEPARTMENTS.forEach((dep) => {
      result.departments[dep] = { ...progress(dep), totalInitiativeCount: itemsFor(state, dep).length };
    });
  }
  return result;
}
function submit(state, dep, identity, data, note) {
  role(identity, "lead");
  if (!hasDepartment(identity, dep)) fail("负责人只能提交本部门方案。");
  const d = department(state, dep);
  requireUnlocked(state, dep);
  const items = itemsFor(state, dep);
  if (!items.length) fail("部门没有可提交的 Initiative。");
  if (d.status === "returned") {
    const previous = d.versions[d.versions.length - 1];
    const hasReviewedRevision =
      previous &&
      items.some((i) => {
        const submitted = previous.initiatives.find((old) => old.id === i.id);
        return submitted && i.revision > submitted.revision;
      });
    if (!hasReviewedRevision)
      fail("请先将需复核的 Initiative 退回 Owner，重新完成后再提交。");
  }
  if (items.some((i) => i.status !== "completed"))
    fail("本部门所有 Initiative 均须由 Owner 标记完成。");
  for (const i of items) {
    const errors = completionErrors(i, data);
    if (errors.length) fail(i.name + "：" + errors.join("\n"));
  }
  const version = {
    id: uid(dep + "-V" + (d.versions.length + 1)),
    number: d.versions.length + 1,
    createdAt: now(),
    note: String(note || ""),
    initiatives: clone(items),
    reference: clone(state.reference),
    guideVersion: state.guide.version,
  };
  d.versions.push(version);
  d.activeVersionId = version.id;
  d.status = "submitted";
  audit(state, identity, "submit_department", dep, version.id);
  return clone(version);
}
function returnDepartment(state, dep, comment, identity) {
  role(identity, "management");
  fail("管理层为只读通览，请线下联系管理员处理。");
}
function returnInitiative(state, id, comment, identity) {
  role(identity, "lead");
  const i = initiative(state, id);
  if (!hasDepartment(identity, i.department))
    fail("负责人只能退回本部门 Initiative。");
  requireUnlocked(state, i.department);
  if (!hasText(comment)) fail("退回 Owner 须填写明确意见。");
  const c = {
    id: uid("C"),
    createdAt: now(),
    author: "lead",
    initiativeId: id,
    text: comment.trim(),
  };
  department(state, i.department).comments.push(c);
  changed(i);
  audit(state, identity, "return_initiative", id, comment.trim());
  return i;
}
function finalize(state, identity) {
  role(identity, "management");
  fail("管理层为只读通览，请线下联系管理员处理。");
}
function setBudget(state, id, amount, identity) {
  migrateState(state);
  role(identity, "admin");
  const i = initiative(state, id);
  requireUnlocked(state, i.department);
  if (!validMoney(amount)) fail("预算须为非负有限金额，最多两位小数。");
  const previous = i.budget;
  i.budget = amount;
  changed(i);
  audit(
    state,
    identity,
    "set_budget",
    id,
    "预算由 " + previous + " 调整为 " + amount + "；原分配未改动。",
  );
  return i;
}
function getBudgetReasons(state, identity) {
  migrateState(state);
  identityCheck(identity);
  return clone(state.budgetReasons);
}
function validateOwnerAssignment(item, ownerId, identity, users = []) {
  if (identity?.apiMode) {
    const owner = users.find(
      (user) => user.email?.trim().toLowerCase() === ownerId.trim().toLowerCase() && user.enabled !== false,
    );
    if (
      !owner ||
      !hasDepartment(owner, item.department)
    )
      fail("Owner 必须是项目部门内已启用的邮箱（含部门负责人）。");
    return;
  }
  if (![item.department + "-1", item.department + "-2"].includes(ownerId))
    fail("Owner 必须属于项目所在部门。");
}
function setOwner(state, id, ownerId, identity) {
  migrateState(state);
  role(identity, "admin");
  const item = initiative(state, id);
  validateOwnerAssignment(item, ownerId);
  if (item.ownerId === ownerId) return clone(item);
  const previousOwnerId = item.ownerId;
  item.ownerId = ownerId;
  changed(item);
  audit(
    state,
    identity,
    "set_owner",
    id,
    "Owner " +
      previousOwnerId +
      " → " +
      ownerId,
  );
  return clone(item);
}
function setBudgetReasons(state, reasons, identity) {
  migrateState(state);
  role(identity, "admin");
  if (!Array.isArray(reasons) || !reasons.length || reasons.length > 30)
    fail("原因配置须为 1–30 条记录。");
  const seen = new Set();
  const next = reasons.map((row) => {
    if (
      !row ||
      typeof row !== "object" ||
      Array.isArray(row) ||
      Object.keys(row).some(
        (key) => !["id", "label", "enabled"].includes(key),
      ) ||
      !hasText(row.id) ||
      !/^[a-z][a-z0-9_-]{0,63}$/.test(row.id) ||
      !hasText(row.label) ||
      row.label.trim().length > 80 ||
      typeof row.enabled !== "boolean"
    )
      fail("原因配置格式无效。");
    if (seen.has(row.id)) fail("原因编号重复。");
    seen.add(row.id);
    return { id: row.id, label: row.label.trim(), enabled: row.enabled };
  });
  const used = new Set(
    state.initiatives.flatMap((item) =>
      budgetRows(item).map((row) => row.reasonId),
    ),
  );
  state.budgetReasons.forEach((row) => {
    if (used.has(row.id) && !seen.has(row.id))
      fail("原因“" + row.label + "”仍被预算行使用，不能删除。");
  });
  state.budgetReasons = next;
  state.budgetReasonVersion += 1;
  audit(
    state,
    identity,
    "set_budget_reasons",
    "budgetReasons",
    "原因配置已更新。",
  );
  return clone(state.budgetReasons);
}
function applyAdminConfiguration(
  state,
  updates,
  identity,
  users = [],
  creates = [],
) {
  migrateState(state);
  role(identity, "admin");
  if (
    !Array.isArray(updates) ||
    !Array.isArray(creates) ||
    (!updates.length && !creates.length)
  )
    fail("没有需要写入的配置变化。");
  const seen = new Set();
  const pending = updates.map((patch) => {
    if (
      !patch ||
      typeof patch !== "object" ||
      Array.isArray(patch) ||
      Object.keys(patch).some(
        (key) => !["id", "budget", "ownerId", "revision"].includes(key),
      )
    )
      fail("配置只能包含项目编号、预算、Owner 与修订号。");
    if (seen.has(patch.id)) fail("导入配置包含重复的 Initiative。");
    seen.add(patch.id);
    const i = initiative(state, patch.id);
    requireUnlocked(state, i.department);
    if (patch.revision !== i.revision) fail("项目修订已变化，请重新预览配置。");
    if (!validMoney(patch.budget)) fail("预算须为非负有限金额，最多两位小数。");
    validateOwnerAssignment(i, patch.ownerId, identity, users);
    return { i, patch };
  });
  const businessKeys = new Set(
    state.initiatives.map((item) =>
      JSON.stringify([
        item.sector,
        item.department,
        item.resourceType,
        item.name,
      ]),
    ),
  );
  const additions = creates.map((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      Object.keys(item).some(
        (key) =>
          ![
            "name",
            "sector",
            "resourceType",
            "department",
            "budget",
            "ownerId",
          ].includes(key),
      )
    )
      fail("新增配置字段无效。");
    if (!hasText(item.name) || item.name.trim().length > 255)
      fail("Initiative 名称不能为空且最多 255 个字符。");
    if (!hasText(item.sector) || item.sector.trim().length > 32)
      fail("Sector 不能为空且最多 32 个字符。");
    if (!hasText(item.department) || item.department.length > 32)
      fail("部门不能为空且最多 32 个字符。");
    if (!["MRD", "SP&A", "ICE Rebate", "Capex"].includes(item.resourceType))
      fail("资源类型必须为 MRD、SP&A、ICE Rebate 或 Capex。");
    if (!validMoney(item.budget)) fail("预算须为非负有限金额，最多两位小数。");
    const normalized = {
      name: item.name.trim(),
      sector: item.sector.trim(),
      resourceType: item.resourceType,
      department: item.department,
      budget: item.budget,
      ownerId: item.ownerId,
    };
    validateOwnerAssignment(normalized, item.ownerId, identity, users);
    const key = JSON.stringify([
      normalized.sector,
      normalized.department,
      normalized.resourceType,
      normalized.name,
    ]);
    if (businessKeys.has(key))
      fail("同部门、Sector 和资源类型下 Initiative 名称已存在。");
    businessKeys.add(key);
    return normalized;
  });
  const replacements = new Map(
    pending.map(({ i, patch }) => [i.id, patch.budget]),
  );
  const totalCents = state.initiatives.reduce(
    (sum, i) =>
      sum + cents(replacements.has(i.id) ? replacements.get(i.id) : i.budget),
    additions.reduce((sum, item) => sum + cents(item.budget), 0),
  );
  if (!Number.isSafeInteger(totalCents)) fail("合计预算超出可安全计算范围。");
  // Validate the entire batch before writing any row; allocations and snapshots are untouched.
  const applied = [];
  pending.forEach(({ i, patch }) => {
    if (i.budget === patch.budget && i.ownerId === patch.ownerId) return;
    const previous = { budget: i.budget, ownerId: i.ownerId };
    i.budget = patch.budget;
    i.ownerId = patch.ownerId;
    changed(i);
    audit(
      state,
      identity,
      "import_admin_configuration",
      i.id,
      "预算 " +
        previous.budget +
        " → " +
        i.budget +
        "；Owner " +
        previous.ownerId +
        " → " +
        i.ownerId +
        "；保留原分配，需重新复核完成。",
    );
    applied.push(i.id);
  });
  additions.forEach((item) => {
    const id = uid("INIT");
    const created = {
      id,
      name: item.name,
      sector: item.sector,
      resourceType: item.resourceType,
      department: item.department,
      ownerId: item.ownerId,
      budget: item.budget,
      rows: [],
      otherBudgets: [],
      reserve: 0,
      reserveNote: "",
      nonDealer: 0,
      nonDealerNote: "",
      revision: 0,
      status: "editing",
      savedAt: now(),
    };
    state.initiatives.push(created);
    state.publications[id] = [];
    audit(
      state,
      identity,
      "import_admin_configuration",
      id,
      "新增 Initiative；预算 " +
        created.budget +
        "；Owner " +
        created.ownerId +
        "。",
    );
    applied.push(id);
  });
  return applied;
}
function editAdminBudget(state, id, fields, identity, users = []) {
  role(identity, "admin");
  const current = initiative(state, id);
  const candidate = clone(state);
  candidate.initiatives = candidate.initiatives.filter((item) => item.id !== id);
  applyAdminConfiguration(candidate, [], identity, users, [fields]);
  Object.assign(current, fields);
  changed(current);
  audit(state, identity, "edit_admin_budget", id, "编辑全部配置；保留分配，需重新同步。");
}
function deleteAdminBudget(state, id, identity) {
  role(identity, "admin");
  const current = initiative(state, id);
  state.initiatives = state.initiatives.filter((item) => item.id !== id);
  delete state.publications[id];
  audit(state, identity, "delete_admin_budget", id, "删除项目：" + current.name);
}
function createState(data, scenario) {
  if (
    !data ||
    !Array.isArray(data.initiatives) ||
    !Array.isArray(data.allocations) ||
    !Array.isArray(data.dealers)
  )
    fail("演示数据结构不完整。");
  scenario = scenario || "working";
  if (!["working", "submitted", "unallocated"].includes(scenario))
    fail("演示场景不存在。");
  const counters = { MKT: 0, ICE: 0, CAPEX: 0 };
  const stamp = now();
  const state = {
    schemaVersion: 2,
    scenario,
    initiatives: [],
    departments: {},
    reference: {
      batchId: "MOCK-REF-V1.2",
      asOf: "2026-08-31",
      importedAt: stamp,
    },
    guide: {
      version: 1,
    },
    budgetReasons: clone(DEFAULT_BUDGET_REASONS),
    budgetReasonVersion: 1,
    publications: {},
    audit: [],
    final: null,
  };
  DEPARTMENTS.forEach((dep) => {
    state.departments[dep] = {
      status: "collecting",
      versions: [],
      activeVersionId: null,
      comments: [],
    };
  });
  const seenIds = new Set();
  state.initiatives = data.initiatives.map((source) => {
    if (seenIds.has(source.id)) fail("源数据 Initiative ID 重复。");
    seenIds.add(source.id);
    const dep = RESOURCE_DEPARTMENT[source.resourceType];
    if (!dep) fail("未配置资源类型的演示部门：" + source.resourceType);
    const ownerId = dep + "-" + ((counters[dep]++ % 2) + 1);
    const item = Object.assign({}, clone(source), {
      department: dep,
      ownerId,
      rows: data.allocations
        .filter((r) => r.initiativeId === source.id)
        .map((r) => ({ dealerId: r.dealerId, amount: r.amount, note: "" })),
      otherBudgets: [],
      reserve: 0,
      reserveNote: "",
      nonDealer: 0,
      nonDealerNote: "",
      revision: 1,
      status: "completed",
      savedAt: stamp,
    });
    const errors = completionErrors(item, data);
    if (errors.length) fail("源数据 " + source.id + "：" + errors.join("\n"));
    return item;
  });
  if (data.allocations.some((r) => !seenIds.has(r.initiativeId)))
    fail("源数据分配引用了不存在的 Initiative。");
  if (scenario === "working") {
    const first = state.initiatives.find((i) => i.ownerId === "MKT-1");
    if (first) first.status = "editing";
  } else if (scenario === "unallocated") {
    const reduce = (item, percent, reasonId, note, leaveGap) => {
      const positive = item.rows.filter((entry) => cents(entry.amount) > 0);
      const available = positive.reduce(
        (sum, entry) => sum + cents(entry.amount),
        0,
      );
      if (!available) fail("未分配预算示例缺少可调整的经销商分配。");
      const amount = Math.max(1, Math.round(available * percent));
      let remaining = amount;
      positive.forEach((row, index) => {
        const current = cents(row.amount);
        const reduction =
          index === positive.length - 1
            ? remaining
            : Math.min(current, Math.floor(current * percent));
        row.amount = money(current - reduction);
        remaining -= reduction;
      });
      if (remaining !== 0) fail("未分配预算示例不能按比例扣减经销商分配。");
      if (!leaveGap)
        item.otherBudgets.push({
          id: "OB-MOCK-" + item.id,
          reasonId,
          amount: money(amount),
          note,
        });
      syncBudgetCompatibility(item);
      changed(item);
    };
    const firstMkt = state.initiatives.find(
      (item) => item.department === "MKT" && item.ownerId === "MKT-1",
    );
    const mktOwned = state.initiatives.filter(
      (item) =>
        item.department === "MKT" &&
        item.ownerId === "MKT-1" &&
        item.id !== firstMkt.id,
    );
    if (mktOwned.length < 3)
      fail("未分配预算示例需要 MKT-1 至少三项可发布 Initiative。");
    const [mktReserve, mktUnallocated, mktOther] = mktOwned;
    const firstIce = state.initiatives.find(
      (item) => item.department === "ICE",
    );
    const firstCapex = state.initiatives.find(
      (item) => item.department === "CAPEX",
    );
    reduce(firstMkt, 0.05, null, "", true);
    reduce(mktReserve, 0.08, "reserve", "Mock：新增经销商储备，待落实", false);
    reduce(
      mktUnallocated,
      0.1,
      "unallocated",
      "Mock：暂未分配至经销商，待后续落实",
      false,
    );
    reduce(mktOther, 0.12, "other", "Mock：其他支出安排，待后续落实", false);
    reduce(
      firstIce,
      0.12,
      "unallocated",
      "Mock：暂未分配至经销商，待后续落实",
      false,
    );
    reduce(firstCapex, 0.1, "other", "Mock：其他支出安排，待后续落实", false);
    [mktReserve, mktUnallocated, mktOther, firstIce, firstCapex].forEach(
      (item) => {
        const errors = completionErrors(item, data, state.budgetReasons);
        if (errors.length) fail("未分配预算示例无效：" + errors.join("\n"));
        item.status = "completed";
      },
    );
    state.initiatives
      .filter((item) => item.id !== firstMkt.id)
      .forEach((item) =>
        publishInitiative(
          state,
          item.id,
          {
            role: "owner",
            department: item.department,
            ownerId: item.ownerId,
          },
          data,
          "Mock：含未分配预算示例",
        ),
      );
    state.demoScenario = {
      id: "unallocated",
      label: "Mock · 含未分配预算示例",
      unfinishedInitiativeId: firstMkt.id,
    };
  } else {
    state.initiatives.forEach((item) =>
      publishInitiative(
        state,
        item.id,
        {
          role: "owner",
          department: item.department,
          ownerId: item.ownerId,
        },
        data,
        "预置演示发布版本 v1",
      ),
    );
  }
  return state;
}
export default {
  departments,
  hasDepartment,
  DEPARTMENTS,
  RESOURCE_DEPARTMENT,
  DEFAULT_BUDGET_REASONS,
  createState,
  migrateState,
  validateInitiative,
  completionErrors,
  totals,
  canEdit,
  updateInitiative,
  complete,
  balanceOtherBudget,
  reopen,
  submit,
  returnDepartment,
  returnInitiative,
  finalize,
  setBudget,
  setOwner,
  getBudgetReasons,
  setBudgetReasons,
  applyAdminConfiguration,
  editAdminBudget,
  deleteAdminBudget,
  getSnapshot,
  publishInitiative,
  latestPublication,
  latestPublishedItems,
  selectView,
  cents,
  money,
  validMoney,
};
