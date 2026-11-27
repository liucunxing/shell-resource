import { assertAuthorizedRead, authorizedReadEpoch } from "./identity-scope";
import { getLocalPreviewConfig, getLocalPreviewEmail, setLocalPreviewEmail } from "./localPreview";
import { assertPreviewResponseCurrent, getPreviewEpoch, getPreviewUserEmail } from "./userPreview";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "/api/v1/workbench").replace(/\/$/, "");
const planningYear = Number(import.meta.env.VITE_PLANNING_YEAR || 2027);
export const DEV_EMAIL_KEY = "shell-resource-dev-email";

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function getDevelopmentEmail() {
  if (isPortalEntry()) return "";
  const localConfig = getLocalPreviewConfig();
  if (localConfig) return getLocalPreviewEmail(localConfig);
  if (typeof sessionStorage === "undefined") return "";
  return String(sessionStorage.getItem(DEV_EMAIL_KEY) || "").trim();
}

export function setDevelopmentEmail(email) {
  if (isPortalEntry()) return;
  if (getLocalPreviewConfig()) { setLocalPreviewEmail(String(email || "").trim()); return; }
  const value = String(email || "").trim();
  if (typeof sessionStorage === "undefined") return;
  if (value) sessionStorage.setItem(DEV_EMAIL_KEY, value);
  else sessionStorage.removeItem(DEV_EMAIL_KEY);
}

// Temporary FineReport Portal handoff; permissions are always resolved by the API.
export function acceptPortalEmail() {
  if (isPortalEntry() || getLocalPreviewConfig()) return;
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const entries = [...url.searchParams].filter(([key]) => key.trim() === "user_email");
  if (!entries.length) return;
  const email = entries.length === 1 ? entries[0][1].trim().toLowerCase() : "";
  // An invalid handoff must never fall back to a previously logged-in account.
  const valid = /^[0-9a-f]{32}$/.test(email);
  setDevelopmentEmail(valid ? email : "");
  for (const [key] of entries) url.searchParams.delete(key);
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
}

function emailHeader() {
  const email = getDevelopmentEmail();
  return email ? { "X-User-Email": email } : {};
}

export async function request(path, options = {}) {
  const scopeEpoch = authorizedReadEpoch();
  const previewEmail = getPreviewUserEmail();
  const previewEpoch = getPreviewEpoch();
  if (previewEmail && !["GET", "HEAD", "OPTIONS"].includes((options.method || "GET").toUpperCase()))
    throw new ApiError("模拟查看为只读模式，请返回管理员后操作。", 403);
  let response;
  try {
    const requestOptions = {
      cache: "no-store",
      ...options,
      ...(previewEmail ? { cache: "no-store" } : {}),
      headers: {
        Accept: "application/json",
        ...(isPortalEntry() ? {} : emailHeader()),
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
        ...(previewEmail ? { "X-Preview-User-Email": previewEmail } : {}),
      },
    };
    response = await fetch((isPortalEntry() ? PORTAL_API_BASE : API_BASE) + path,
      isPortalEntry() ? portalRequestOptions(requestOptions) : requestOptions);
  } catch (_) {
    assertAuthorizedRead(scopeEpoch);
    assertPreviewResponseCurrent(previewEpoch);
    throw new ApiError("无法连接工作台服务，请检查网络后重试。", 0);
  }
  let body;
  try {
    body = await response.json();
  } catch (_) {
    assertAuthorizedRead(scopeEpoch);
    assertPreviewResponseCurrent(previewEpoch);
    throw new ApiError("服务返回格式无效，请稍后重试。", response.status);
  }
  assertAuthorizedRead(scopeEpoch);
  assertPreviewResponseCurrent(previewEpoch);
  if (!response.ok || body.code !== 200) {
    if (isPortalEntry()) handlePortalRejection(response.status, body.msg);
    throw new ApiError(
      body.msg || "请求未完成，请重试。", response.status,
    );
  }
  return body.data;
}

let selectedVersionId = "";
export const setPlanningVersion = (id) => { selectedVersionId = String(id || ""); };
export const currentIdentity = () => request("/identity");
export const workspace = (versionId = selectedVersionId) => request(`/workspace?planning_year=${planningYear}${versionId ? `&version_id=${encodeURIComponent(versionId)}` : ""}`);
export const versionComparisonSummary = (id) => request(`/version-comparison/summary?planning_year=${planningYear}&version_id=${encodeURIComponent(id)}`);
export const planningVersions = () => request(`/planning-versions?planning_year=${planningYear}`, { cache: "no-store" });
export const createPlanningVersion = (value) => request("/planning-versions", {
  method: "POST", body: JSON.stringify({ planning_year: planningYear, ...value }),
});
export const updatePlanningVersion = (id, value) => request(`/planning-versions/${encodeURIComponent(id)}`, {
  method: "PATCH", body: JSON.stringify(value),
});
export const releasePlanningVersion = (id, value) => request(`/planning-versions/${encodeURIComponent(id)}/release`, {
  method: "POST", body: JSON.stringify(value),
});
export const clearPlanningVersionDrafts = (id, value) => request(`/planning-versions/${encodeURIComponent(id)}/clear-drafts`, {
  method: "POST", body: JSON.stringify(value),
});
export const planningVersionDeletionInfo = (id) => request(`/planning-versions/${encodeURIComponent(id)}/deletion-info`);
export const deletePlanningVersion = (id, value) => request(`/planning-versions/${encodeURIComponent(id)}/delete`, {
  method: "POST", body: JSON.stringify(value),
});
export const createVersionInitiative = (versionId, value) => request(`/planning-versions/${encodeURIComponent(versionId)}/initiatives`, { method: "POST", body: JSON.stringify(value) });
export const updateVersionInitiative = (versionId, id, value) => request(`/planning-versions/${encodeURIComponent(versionId)}/initiatives/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(value) });
export const departmentReview = (versionId, sector, department) => request(
  `/planning-versions/${encodeURIComponent(versionId)}/department?${new URLSearchParams({ sector, department })}`,
);
export const reviewDepartment = (versionId, action, value) => request(
  `/planning-versions/${encodeURIComponent(versionId)}/department/${action}`,
  { method: "POST", body: JSON.stringify(value) },
);
export const distributors = () => request("/distributors");
export const getDraft = (id) => request(`/initiatives/${encodeURIComponent(id)}/draft`);
export const saveDraft = (id, item, expectedRevision = item.revision) =>
  request(`/initiatives/${encodeURIComponent(id)}/draft`, {
    method: "PUT",
    body: JSON.stringify({
      expected_revision: expectedRevision,
      ...(item.changeReason !== undefined ? { changeReason: item.changeReason } : {}),
      ...(item.editorState !== undefined ? { editorState: item.editorState } : {}),
      rows: item.rows.map(({ dealerId, amount, note }) => ({ dealerId, amount, note: note || "" })),
      otherBudgets: item.otherBudgets.map(({ id: rowId, reasonId, amount, note }) => ({ id: rowId, reasonId, amount, note: note || "" })),
    }),
  });
export const publish = (id, item, note = "") =>
  request(`/initiatives/${encodeURIComponent(id)}/publish`, {
    method: "POST",
    body: JSON.stringify({ expected_revision: item.revision, note }),
  });
export async function saveThenPublish(id, item, expectedRevision, note = "") {
  const saved = await saveDraft(id, item, expectedRevision);
  const draft = saved.initiative || saved;
  const publication = await publish(id, draft, note);
  return { draft, publication };
}
export const publications = (id) => request(`/initiatives/${encodeURIComponent(id)}/publications`);
export const updateBudgets = (items) => request("/admin/budgets", {
  method: "PUT", body: JSON.stringify({ items }),
});
export const createBudget = (item) => request("/admin/budgets", {
  method: "POST", body: JSON.stringify({ planning_year: planningYear, ...(selectedVersionId ? { version_id: selectedVersionId } : {}), items: [item] }),
});
export const editBudget = (id, item) => request(`/admin/budgets/${encodeURIComponent(id)}`, {
  method: "PUT", body: JSON.stringify(item),
});
export const deleteBudget = (id, expectedRevision) => request(`/admin/budgets/${encodeURIComponent(id)}`, {
  method: "DELETE", body: JSON.stringify({ expected_revision: expectedRevision }),
});
export const importBudgets = (planningYearValue, updates, creates) =>
  request("/admin/budgets/import", {
    method: "POST",
    body: JSON.stringify({
      planning_year: planningYearValue,
      updates,
      creates,
    }),
  });
export const listAdminUsers = (filters = {}, limit = 20, offset = 0) => {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  for (const key of ["email", "name", "role", "department", "sector"])
    if (filters[key]?.trim())
      params.set(key, key === "department" ? filters[key].trim().toUpperCase() : filters[key].trim());
  return request(`/admin/users?${params}`);
};
export const importAdminUsers = (value) => request("/admin/users/import", {
  method: "POST", body: JSON.stringify(value),
});
export const importVersionInitiatives = (versionId, value) => request(`/planning-versions/${encodeURIComponent(versionId)}/initiatives/import`, {
  method: "POST", body: JSON.stringify(value),
});
export const createAdminUser = (value) => request("/admin/users", {
  method: "POST", body: JSON.stringify(value),
});
export const updateAdminUser = (id, value) => request(`/admin/users/${encodeURIComponent(id)}`, {
  method: "PUT", body: JSON.stringify(value),
});
export const deleteAdminUser = (id) => request(`/admin/users/${encodeURIComponent(id)}`, {
  method: "DELETE",
});
export const updateConfig = (value) => request("/admin/config", {
  method: "PUT", body: JSON.stringify(value),
});
export { planningYear };
import { handlePortalRejection, isPortalEntry, portalRequestOptions, PORTAL_API_BASE } from "../portal/session";
