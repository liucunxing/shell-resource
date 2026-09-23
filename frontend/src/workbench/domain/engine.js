"use strict";
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
    !DEPARTMENTS.includes(identity.department)
  )
    fail("部门身份无效。");
  if (
    identity.role === "owner" &&
    (!hasText(identity.ownerId) ||
      (!identity.apiMode &&
        ![identity.department + "-1", identity.department + "-2"].includes(
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
  if (!DEPARTMENTS.includes(dep) || !state.departments[dep])
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
  const ids = new Set(((data && data.dealers) || []).map((d) => d.id));
  const seen = new Set();
  if (!Array.isArray(i.rows)) errors.push("分配明细必须是数组。");
  else
    i.rows.forEach((r, index) => {
      if (!r || !ids.has(r.dealerId))
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
    errors.push("预算未平衡，请处理未解释差额后标记完成。");
  if (!errors.length && Array.isArray(i.otherBudgets))
    i.otherBudgets.forEach((row, index) => {
      if (row.amount > 0 && !hasText(row.note))
        errors.push("第 " + (index + 1) + " 行其他预算须填写原因说明。");
    });
  return errors;
}
function canEdit(state, id, identity) {
  try {
    identityCheck(identity);
    const i = initiative(state, id);
    return (
      identity.role === "owner" &&
      i.department === identity.department &&
      i.ownerId === identity.ownerId &&
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
  ];
  if (Object.keys(patch).some((k) => !allowed.includes(k)))
    fail("Owner 只能调整分配及用途说明，预算和归属由管理员维护。");
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
  changed(i);
  audit(state, identity, "save_initiative", id, "草稿保存，完成标记已取消。");
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
  if (identity.role === "admin") fail("管理员无权读取分配发布内容。");
  if (identity.role === "owner" && item.ownerId !== identity.ownerId)
    fail("无权读取其它 Owner 的发布版本。");
  if (identity.role === "lead" && item.department !== identity.department)
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
  if (identity.role === "lead" && identity.department !== dep)
    fail("无权读取其它部门的发布明细。");
  return latestPublishedItemsInternal(state, dep);
}
function getSnapshot(state, dep, versionId, identity) {
  identityCheck(identity);
  if (["owner", "lead"].includes(identity.role) && identity.department !== dep)
    fail("无权读取其它部门的提交明细。");
  const snapshot = snapshotInternal(state, dep, versionId);
  if (!snapshot) return null;
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
    // Department analysis and submission notes may quote colleagues' rows.
    // Owner receives only fixed metadata plus their own initiative snapshot.
    if (snapshot.insight)
      snapshot.insightStatus = {
        createdAt: snapshot.insight.createdAt,
        stale: Boolean(snapshot.insight.staleAtSubmission),
        promptVersion: snapshot.insight.promptVersion || 1,
      };
    delete snapshot.insight;
    delete snapshot.note;
    if (snapshot.analysisBasis) {
      const basis = snapshot.analysisBasis;
      snapshot.analysisBasis = {
        status: basis.status,
        generatedAt: basis.generatedAt,
        guideVersion: basis.guideVersion,
        promptVersion: basis.promptVersion,
        staleAtSubmission: basis.staleAtSubmission,
      };
    }
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
    insights: {},
    insightStatus: {},
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
    const dep = identity.department;
    const all = itemsFor(state, dep);
    const visible =
      identity.role === "lead"
        ? all
        : all.filter((i) => i.ownerId === identity.ownerId);
    const allowedIds = new Set(visible.map((i) => i.id));
    result.initiatives = visible.map((item) => {
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
    });
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
    if (state.insights[dep]) {
      if (identity.role === "owner")
        result.insightStatus[dep] = {
          createdAt: state.insights[dep].createdAt,
          stale: insightIsStale(state, dep),
          promptVersion: state.insights[dep].promptVersion || 1,
        };
      else
        result.insights[dep] = Object.assign(clone(state.insights[dep]), {
          stale: insightIsStale(state, dep),
        });
    }
    if (identity.role === "owner") {
      const ownerScope = "owner:" + identity.ownerId;
      if (state.insights[ownerScope])
        result.insights[ownerScope] = Object.assign(
          clone(state.insights[ownerScope]),
          { stale: insightIsStale(state, ownerScope) },
        );
      visible.forEach((item) => {
        const itemScope = "initiative:" + item.id;
        if (state.insights[itemScope])
          result.insights[itemScope] = Object.assign(
            clone(state.insights[itemScope]),
            { stale: insightIsStale(state, itemScope) },
          );
      });
    }
    // Final ids from other departments do not belong in an Owner/Lead view.
    result.final = state.final
      ? {
          id: state.final.id,
          createdAt: state.final.createdAt,
          departmentVersionId: state.final.departmentVersions[dep],
        }
      : null;
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
    result.initiatives = state.initiatives.map((i) => ({
      id: i.id,
      name: i.name,
      resourceType: i.resourceType,
      sector: i.sector,
      department: i.department,
      ownerId: i.ownerId,
      budget: i.budget,
      status: i.status,
      revision: i.revision,
    }));
    DEPARTMENTS.forEach((dep) => {
      result.departments[dep] = progress(dep);
    });
  }
  return result;
}
function submit(state, dep, identity, data, note) {
  role(identity, "lead");
  if (identity.department !== dep) fail("负责人只能提交本部门方案。");
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
    insight: state.insights[dep] ? clone(state.insights[dep]) : null,
  };
  if (version.insight)
    version.insight.staleAtSubmission = insightIsStale(state, dep);
  version.analysisBasis = version.insight
    ? {
        insightId: version.insight.id,
        status: version.insight.status,
        generatedAt: version.insight.createdAt,
        reference: clone(version.insight.reference),
        guideVersion: version.insight.guideVersion,
        promptVersion: version.insight.promptVersion || 1,
        basisToken: version.insight.signature,
        staleAtSubmission: version.insight.staleAtSubmission,
      }
    : {
        insightId: null,
        status: "not_generated",
        generatedAt: null,
        reference: null,
        guideVersion: null,
        promptVersion: null,
        basisToken: null,
        staleAtSubmission: null,
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
  if (identity.department !== i.department)
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
function clearReassignmentCaches(
  state,
  initiativeId,
  previousOwnerId,
  nextOwnerId,
) {
  [
    "owner:" + previousOwnerId,
    "owner:" + nextOwnerId,
    "initiative:" + initiativeId,
  ].forEach((scope) => {
    delete state.insights[scope];
    if (state.analysisPrompts) delete state.analysisPrompts[scope];
  });
}
function validateOwnerAssignment(item, ownerId, identity, users = []) {
  if (identity?.apiMode) {
    const owner = users.find(
      (user) => user.email === ownerId && user.role === "owner",
    );
    if (
      !owner ||
      owner.department !== item.department ||
      (owner.sector && owner.sector !== item.sector)
    )
      fail("Owner 必须是项目部门及业务范围内已配置的 Owner 邮箱。");
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
  clearReassignmentCaches(state, item.id, previousOwnerId, ownerId);
  changed(item);
  audit(
    state,
    identity,
    "set_owner",
    id,
    "Owner " +
      previousOwnerId +
      " → " +
      ownerId +
      "；已清除归属相关 Insight 与提示词缓存。",
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
function applyAdminConfiguration(state, updates, identity, users = []) {
  migrateState(state);
  role(identity, "admin");
  if (!Array.isArray(updates) || !updates.length)
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
  const replacements = new Map(
    pending.map(({ i, patch }) => [i.id, patch.budget]),
  );
  const totalCents = state.initiatives.reduce(
    (sum, i) =>
      sum + cents(replacements.has(i.id) ? replacements.get(i.id) : i.budget),
    0,
  );
  if (!Number.isSafeInteger(totalCents)) fail("合计预算超出可安全计算范围。");
  // Validate the entire batch before writing any row; allocations and snapshots are untouched.
  const applied = [];
  pending.forEach(({ i, patch }) => {
    if (i.budget === patch.budget && i.ownerId === patch.ownerId) return;
    const previous = { budget: i.budget, ownerId: i.ownerId };
    i.budget = patch.budget;
    i.ownerId = patch.ownerId;
    if (previous.ownerId !== i.ownerId) {
      // An Owner-scoped record may contain allocations and narrative that are
      // no longer authorized once the Initiative is reassigned.  Remove it
      // rather than presenting it as merely stale to either side.
      clearReassignmentCaches(state, i.id, previous.ownerId, i.ownerId);
    }
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
  return applied;
}
function changeReference(state, identity) {
  role(identity, "admin");
  state.reference = {
    batchId: uid("MOCK-REF"),
    asOf: state.reference.asOf,
    importedAt: now(),
  };
  audit(
    state,
    identity,
    "change_reference",
    state.reference.batchId,
    "模拟发布新批次；历史数值未补造，已提交快照保持原依据。",
  );
  return clone(state.reference);
}
function setGuide(state, text, identity) {
  role(identity, "admin");
  if (!hasText(text)) fail("业务分析指南不能为空。");
  state.guide = { version: state.guide.version + 1, text: text.trim() };
  audit(state, identity, "set_guide", "guide", "指南 v" + state.guide.version);
  return clone(state.guide);
}
const DEFAULT_ANALYSIS_PROMPT =
  "请按以下六点分析，每点 1–3 句话并给出证据与复核方向：1. 历史低 Yield 与未来投入；2. 历史高 Yield 与未来投入；3. 头部 Distributor 集中度；4. 跨部门或多 Initiative 叠加；5. 分配变化与历史 Vol/C3 趋势；6. 预算完整性及尚未到经销商的预算。只使用当前权限内事实，不作因果推断，不将排序作为阈值，不将 2026 年累计与全年比较。此配置用于模拟分析依据展示，模板不会执行任意自然语言指令。";
function insightScope(state, scope) {
  if (scope === "global")
    return {
      kind: "global",
      scope,
      department: null,
      items: DEPARTMENTS.flatMap((dep) =>
        latestPublishedItemsInternal(state, dep),
      ),
    };
  if (typeof scope === "string" && scope.startsWith("initiative:")) {
    const item = initiative(state, scope.slice("initiative:".length));
    return {
      kind: "initiative",
      scope,
      department: item.department,
      ownerId: item.ownerId,
      items: [item],
      initiativeId: item.id,
    };
  }
  if (typeof scope === "string" && scope.startsWith("owner:")) {
    const ownerId = scope.slice("owner:".length);
    const items = state.initiatives.filter((item) => item.ownerId === ownerId);
    if (!items.length) fail("Owner Insight 范围不存在。");
    return {
      kind: "owner",
      scope,
      department: items[0].department,
      ownerId,
      items,
    };
  }
  department(state, scope);
  return {
    kind: "department",
    scope,
    department: scope,
    items: itemsFor(state, scope),
  };
}
function assertInsightScopeAccess(state, descriptor, identity, allowAdmin) {
  identityCheck(identity);
  if (identity.role === "admin") {
    if (allowAdmin) return;
    fail("管理员无权读取分配分析内容。");
  }
  if (descriptor.kind === "global") {
    if (identity.role !== "management") fail("仅管理层可查看全局 Insight。");
    return;
  }
  if (identity.role === "lead" && identity.department === descriptor.department)
    return;
  if (
    identity.role === "owner" &&
    descriptor.ownerId === identity.ownerId &&
    descriptor.department === identity.department
  )
    return;
  fail("无权读取或编辑此 Insight 范围。");
}
function effectivePrompt(state, scope) {
  return Object.assign(
    { text: DEFAULT_ANALYSIS_PROMPT, version: 1 },
    (state.analysisPrompts || {})[scope] || {},
    { scope },
  );
}
function getAnalysisPrompt(state, scope, identity) {
  migrateState(state);
  const descriptor = insightScope(state, scope);
  assertInsightScopeAccess(state, descriptor, identity, true);
  const editable =
    identity.role === "admin" ||
    (identity.role === "lead" &&
      descriptor.kind === "department" &&
      descriptor.department === identity.department) ||
    (identity.role === "owner" &&
      ["owner", "initiative"].includes(descriptor.kind)) ||
    false;
  return Object.assign({}, effectivePrompt(state, scope), { editable });
}
function setAnalysisPrompt(state, scope, text, identity) {
  const current = getAnalysisPrompt(state, scope, identity);
  if (!current.editable) fail("当前角色无权编辑此范围的分析提示词。");
  if (!hasText(text)) fail("分析提示词不能为空。");
  if (text.trim().length > 12000) fail("分析提示词最多 12000 字。");
  state.analysisPrompts = state.analysisPrompts || {};
  state.analysisPrompts[scope] = {
    text: text.trim(),
    version: current.version + 1,
  };
  audit(
    state,
    identity,
    "set_analysis_prompt",
    scope,
    "提示词 v" + (current.version + 1),
  );
  return getAnalysisPrompt(state, scope, identity);
}
// Bump whenever analysis semantics or shared historical authorization changes.
const ANALYSIS_BASIS_VERSION = "2026-09-22-latest-publication-owner-scope-v1";
function signature(state, scope) {
  migrateState(state);
  const descriptor = insightScope(state, scope);
  const basis = descriptor.items.map((i) => [
    i.id,
    i.revision,
    i.publicationId || null,
    i.publishedRevision || null,
    i.publishedAt || null,
    i.budget,
    i.rows,
    i.reserve,
    i.reserveNote,
    i.nonDealer,
    i.otherBudgets,
  ]);
  const input = JSON.stringify({
    analysisBasisVersion: ANALYSIS_BASIS_VERSION,
    scope,
    basis,
    reference: state.reference,
    guideVersion: state.guide.version,
    budgetReasons: state.budgetReasons,
    budgetReasonVersion: state.budgetReasonVersion,
    prompt: effectivePrompt(state, scope),
  });
  // A compact change-detection token only; not an authentication or security primitive.
  let a = 2166136261,
    b = 2246822507;
  for (let n = 0; n < input.length; n++) {
    a = Math.imul(a ^ input.charCodeAt(n), 16777619);
    b = Math.imul(b ^ input.charCodeAt(n), 3266489909);
  }
  return (
    "basis-" +
    (a >>> 0).toString(16).padStart(8, "0") +
    (b >>> 0).toString(16).padStart(8, "0")
  );
}
function insightIsStale(state, scope) {
  const record = state.insights[scope];
  return (
    !record ||
    record.signature !== signature(state, scope) ||
    record.reference.batchId !== state.reference.batchId
  );
}
function generateInsight(state, scope, identity, options) {
  migrateState(state);
  const descriptor = insightScope(state, scope);
  assertInsightScopeAccess(state, descriptor, identity, false);
  if (descriptor.kind === "global" && !(options && options.preview))
    fail("管理层 Insight 为只读预览，不写入工作台状态。");
  if (
    descriptor.kind === "department" &&
    identity.role !== "lead" &&
    identity.role !== "admin"
  )
    fail("仅本部门负责人可生成部门 Insight。");
  if (options && options.fail)
    fail("模拟 Insight 生成失败；原记录保留，草稿不受影响。");
  let source,
    reference = clone(state.reference),
    basisLabel,
    publicationReferences = null;
  if (descriptor.kind === "global") {
    source = descriptor.items;
    if (!source.length) fail("暂无已发布 Initiative，不能生成管理层预览。");
    publicationReferences = source.map((item) => {
      const publication = latestPublicationInternal(state, item.id);
      return {
        initiativeId: item.id,
        publicationId: publication.id,
        reference: clone(publication.reference),
      };
    });
    const batches = [
      ...new Set(publicationReferences.map((item) => item.reference.batchId)),
    ];
    reference =
      batches.length === 1
        ? clone(publicationReferences[0].reference)
        : {
            batchId: "MIXED-PUBLISHED-REFERENCES",
            asOf: null,
            importedAt: null,
          };
    basisLabel =
      "各部门最新已发布 Initiative · " +
      source.length +
      " 项" +
      (batches.length === 1
        ? " · 参考 " + batches[0]
        : " · 发布参考批次不一致，需分别复核");
  } else if (["owner", "initiative"].includes(descriptor.kind)) {
    source = descriptor.items;
    basisLabel =
      descriptor.kind === "initiative"
        ? "本人当前 Initiative 工作稿"
        : "本人当前 Initiative 汇总工作稿";
  } else {
    source = descriptor.items;
    basisLabel = "本部门当前工作稿";
  }
  if (
    descriptor.kind === "department" &&
    reference.batchId !== state.reference.batchId
  )
    fail(
      "当前提交版本绑定旧参考批次，不能生成当前有效 Insight；请查看原分析记录，或退回方案后按新批次重新提交。",
    );
  const total = totals(source);
  const reasonLabels = new Map(
    state.budgetReasons.map((row) => [row.id, row.label]),
  );
  const otherByReason = new Map();
  source.forEach((item) =>
    budgetRows(item).forEach((row) => {
      otherByReason.set(
        row.reasonId,
        (otherByReason.get(row.reasonId) || 0) + cents(row.amount || 0),
      );
    }),
  );
  const dealerTotals = new Map();
  source.forEach((i) =>
    i.rows.forEach((r) => {
      if (cents(r.amount) <= 0) return;
      const d = dealerTotals.get(r.dealerId) || {
        amount: 0,
        initiatives: new Set(),
        departments: new Set(),
      };
      d.amount += cents(r.amount);
      d.initiatives.add(i.id);
      d.departments.add(i.department);
      dealerTotals.set(r.dealerId, d);
    }),
  );
  const ranked = Array.from(dealerTotals, ([id, d]) => ({ id, ...d })).sort(
    (a, b) => b.amount - a.amount || String(a.id).localeCompare(String(b.id)),
  );
  const format = (value) =>
    Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
  const rawDealers = new Map(
    (((options || {}).data || {}).dealers || []).map((d) => [d.id, d]),
  );
  const history = (id) => (rawDealers.get(id) || {}).history || {};
  const numeric = (value) =>
    typeof value === "number" && Number.isFinite(value);
  const historicalResource = (h) => {
    if (descriptor.kind === "global")
      return numeric(h.resource2025) ? h.resource2025 : null;
    const values = Object.keys(RESOURCE_DEPARTMENT)
      .filter((k) => RESOURCE_DEPARTMENT[k] === descriptor.department)
      .map((k) => (h.resources2025 || {})[k]);
    return values.every(numeric) ? values.reduce((a, b) => a + b, 0) : null;
  };
  const make = (key, finding, object, evidence, review, status) => ({
    key,
    finding,
    object,
    evidence,
    review,
    text: evidence + review,
    status,
  });
  const top = ranked[0];
  const topFact = top
    ? top.id + " 的本范围 2027 分配为 " + format(money(top.amount)) + "。"
    : "本范围暂无经销商分配。";
  const yieldRows = ranked
    .map((d) => {
      const h = history(d.id);
      const value =
        numeric(h.c32025) && numeric(h.resource2025) && h.resource2025 > 0
          ? h.c32025 / h.resource2025
          : null;
      return numeric(value) ? { ...d, yield: value } : null;
    })
    .filter(Boolean)
    .sort(
      (a, b) => a.yield - b.yield || String(a.id).localeCompare(String(b.id)),
    );
  const yieldItem = (high) => {
    const key = high ? "high_yield" : "low_yield";
    const finding = high
      ? "历史高 Yield 与未来投入不足复核"
      : "历史低 Yield 与未来高投入复核";
    const candidate = yieldRows[high ? yieldRows.length - 1 : 0];
    if (!candidate)
      return make(
        key,
        finding,
        top ? top.id : scope,
        "缺少有效的同年 C3 或正数整体资源，暂不能计算历史 Yield。" + topFact,
        "请补齐同年历史依据后结合未来业务计划复核，不能仅凭投入金额认定投入过高或不足。",
        "limited",
      );
    const h = history(candidate.id);
    return make(
      key,
      finding,
      candidate.id,
      candidate.id +
        " 在本范围有可比历史且参与分配的经销商中，2025 全年 Yield 相对" +
        (high ? "最高" : "最低") +
        "，为 " +
        format(candidate.yield) +
        (descriptor.kind === "global"
          ? "（2025 C3 " +
            format(h.c32025) +
            " ÷ 同年整体资源 " +
            format(h.resource2025) +
            "）"
          : "（公式：同年 C3 ÷ 同年整体资源；整体 Yield 为已授权只读参考）") +
        "；本范围 2027 分配 " +
        format(money(candidate.amount)) +
        "。",
      "这是相对排序而非判断标准；尚无 2027 业务预测，需核对新增目标及投入理由，不能认定投入过高或不足，也不能推断因果。",
      "review",
    );
  };
  const results = [yieldItem(false), yieldItem(true)];
  const otherSummary = Array.from(
    otherByReason,
    ([reasonId, amount]) =>
      (reasonLabels.get(reasonId) || reasonId) + " " + format(money(amount)),
  ).join("；");
  results.push(
    make(
      "concentration",
      "头部 Distributor 分配集中度",
      top ? top.id : scope,
      top
        ? "2027 分配最高的经销商 " +
            top.id +
            " 获分 " +
            format(money(top.amount)) +
            "，占本范围经销商分配 " +
            (total.allocated
              ? ((top.amount / cents(total.allocated)) * 100).toFixed(2)
              : "0.00") +
            "%（分母 " +
            format(total.allocated) +
            "）。"
        : "本范围经销商分配为零，暂无可计算的集中度。",
      "复核承接能力、分配理由与其它对象的覆盖情况；排序和占比不作为限制提交的阈值。",
      top && total.allocated ? "observed" : "limited",
    ),
  );
  const overlaps = ranked.filter(
    (d) =>
      d.amount > 0 &&
      (descriptor.kind === "global"
        ? d.departments.size > 1 || d.initiatives.size > 1
        : d.initiatives.size > 1),
  );
  const shared = overlaps[0];
  results.push(
    make(
      "overlap",
      "跨部门或多 Initiative 叠加",
      shared ? shared.id : scope,
      shared
        ? "本范围有 " +
            overlaps.length +
            " 个经销商承接多项资源，其中 " +
            shared.id +
            " 涉及 " +
            shared.initiatives.size +
            " 项 Initiative" +
            (descriptor.kind === "global"
              ? "、" + shared.departments.size + " 个部门"
              : "（仅本人授权范围）") +
            "，合计 " +
            format(money(shared.amount)) +
            "。"
        : "本范围未观察到同一经销商的多项资源叠加。",
      (descriptor.kind === "global"
        ? ""
        : "当前无其它部门资源明细授权，不能判断跨部门叠加；") +
        "应复核用途与目标衔接，叠加本身不代表浪费或重复。",
      shared ? "review" : "observed",
    ),
  );
  const trendDealer = ranked.find((d) => {
    const h = history(d.id);
    return (
      numeric(h.vol2024) &&
      h.vol2024 > 0 &&
      numeric(h.vol2025) &&
      numeric(h.c32024) &&
      h.c32024 > 0 &&
      numeric(h.c32025)
    );
  });
  if (trendDealer) {
    const h = history(trendDealer.id),
      resource = historicalResource(h);
    const pct = (a, b) => ((a / b - 1) * 100).toFixed(2) + "%";
    results.push(
      make(
        "trend",
        "分配变化与历史 Vol / C3 趋势",
        trendDealer.id,
        trendDealer.id +
          " 的 2025 对 2024 全年 Vol 同比 " +
          pct(h.vol2025, h.vol2024) +
          "，C3 同比 " +
          pct(h.c32025, h.c32024) +
          "。" +
          (resource !== null && resource > 0
            ? "2027 本范围计划分配 " +
              format(money(trendDealer.amount)) +
              " 对 2025 本范围历史资源 " +
              format(resource) +
              " 变化 " +
              pct(money(trendDealer.amount), resource) +
              "，为跨两年比较，非同比。"
            : "缺少本范围可比历史资源，不能比较投入变化。"),
        "尚无 2027 Vol/C3 预测，需业务说明投入变化与目标是否匹配；2026 年 1–8 月累计不与全年同比、不默认年化。",
        "review",
      ),
    );
  } else
    results.push(
      make(
        "trend",
        "分配变化与历史 Vol / C3 趋势",
        scope,
        "缺少本范围经销商可比较的 2024 / 2025 全年 Vol、C3，暂不能判断历史趋势。",
        "需补齐同口径历史和 2027 业务目标；2026 年累计不能与全年同比，也不自动年化。",
        "limited",
      ),
    );
  results.push(
    make(
      "completeness",
      "预算完整性及尚未到经销商的预算",
      scope,
      "2027 预算 " +
        format(total.budget) +
        "，经销商分配 " +
        format(total.allocated) +
        "，其他预算安排 " +
        format(total.otherBudget) +
        (otherSummary ? "（" + otherSummary + "）" : "") +
        "，未解释差额 " +
        format(total.gap) +
        "。",
      total.gap === 0
        ? "金额已平衡，仍需核实各项其他预算的用途和落地条件；预算平衡不代表全部已分到经销商。"
        : "请解释或调整未平衡差额，并确认各项其他预算用途；未到经销商的预算不直接视为遗漏。",
      total.gap === 0 ? "observed" : "review",
    ),
  );
  const prompt = effectivePrompt(state, scope);
  const record = {
    id: uid("INSIGHT"),
    scope,
    mock: true,
    status: "generated",
    signature: signature(state, scope),
    analysisMethodVersion: ANALYSIS_BASIS_VERSION,
    reference,
    publicationReferences,
    guideVersion: state.guide.version,
    createdAt: now(),
    basisLabel,
    items: results,
    guideText: state.guide.text,
    promptText: prompt.text,
    promptVersion: prompt.version,
    promptScope: prompt.scope,
    disclaimer:
      "模拟 Insight；六点固定模板，提示词作为可编辑分析依据保存，不调用真实模型；不推断因果、不跨年计算 Yield。",
  };
  state.insights[scope] = record;
  audit(state, identity, "generate_insight", scope, record.id);
  return clone(record);
}
function previewInsight(state, scope, identity, options) {
  // Management gets a computed read-only preview; the source state and its
  // audit log remain untouched.
  const working = clone(state);
  return generateInsight(
    working,
    scope,
    identity,
    Object.assign({}, options, { preview: true }),
  );
}
function getInsight(state, scope, identity) {
  migrateState(state);
  const descriptor = insightScope(state, scope);
  assertInsightScopeAccess(state, descriptor, identity, false);
  const record = state.insights[scope];
  return record
    ? Object.assign(clone(record), { stale: insightIsStale(state, scope) })
    : null;
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
      text: "结合 2027 分配、用途和授权历史事实，输出发现、证据、对象、复核方向。保持 2024/2025 全年与 2026 年 1–8 月累计口径边界，不推断投入与 C3 的因果关系，不把跨部门叠加直接认定为浪费。",
    },
    insights: {},
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
  changeReference,
  setGuide,
  getAnalysisPrompt,
  setAnalysisPrompt,
  generateInsight,
  previewInsight,
  getInsight,
  insightIsStale,
  getSnapshot,
  publishInitiative,
  latestPublication,
  latestPublishedItems,
  selectView,
  signature,
  cents,
  money,
  validMoney,
};
