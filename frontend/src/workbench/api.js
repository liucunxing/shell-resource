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
  if (typeof sessionStorage === "undefined") return "";
  return String(sessionStorage.getItem(DEV_EMAIL_KEY) || "").trim();
}

export function setDevelopmentEmail(email) {
  const value = String(email || "").trim();
  if (typeof sessionStorage === "undefined") return;
  if (value) sessionStorage.setItem(DEV_EMAIL_KEY, value);
  else sessionStorage.removeItem(DEV_EMAIL_KEY);
}

// Temporary FineReport Portal handoff; permissions are always resolved by the API.
export function acceptPortalEmail() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const entries = [...url.searchParams].filter(([key]) => key.trim() === "user_email");
  // Do not reuse an email from a prior visit: access starts with a Portal handoff.
  if (!entries.length) {
    setDevelopmentEmail("");
    return;
  }
  const email = entries.length === 1 ? entries[0][1].trim().toLowerCase() : "";
  // An invalid handoff must never fall back to a previously logged-in account.
  const valid = email.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  setDevelopmentEmail(valid ? email : "");
  for (const [key] of entries) url.searchParams.delete(key);
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
}

function emailHeader() {
  const email = getDevelopmentEmail();
  return email ? { "X-User-Email": email } : {};
}

export async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(API_BASE + path, {
      ...options,
      headers: {
        Accept: "application/json",
        ...emailHeader(),
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch (_) {
    throw new ApiError("无法连接工作台服务，请检查网络后重试。", 0);
  }
  let body;
  try {
    body = await response.json();
  } catch (_) {
    throw new ApiError("服务返回格式无效，请稍后重试。", response.status);
  }
  if (!response.ok || body.code !== 200) {
    throw new ApiError(body.msg || "请求未完成，请重试。", response.status);
  }
  return body.data;
}

export const workspace = () => request(`/workspace?planning_year=${planningYear}`);
export const distributors = () => request("/distributors");
export const saveDraft = (id, item, expectedRevision = item.revision) =>
  request(`/initiatives/${encodeURIComponent(id)}/draft`, {
    method: "PUT",
    body: JSON.stringify({
      expected_revision: expectedRevision,
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
export const uploadReference = (value) => request("/admin/reference", {
  method: "POST", body: JSON.stringify(value),
});
export const getInsights = (scope, presetId = "comprehensive") => request(`/insights?scope=${encodeURIComponent(scope)}&planning_year=${planningYear}&preset_id=${encodeURIComponent(presetId)}`);
export async function generateInsights(scope, presetId = "comprehensive") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 65000);
  try {
    return await request("/insights/generate", {
      method: "POST", signal: controller.signal,
      body: JSON.stringify({ scope, planning_year: planningYear, preset_id: presetId }),
    });
  } catch (error) {
    if (controller.signal.aborted)
      throw new ApiError("分析等待超时，请稍后刷新查看或重试。", 504);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
export const saveInsightPrompt = (scope, text, expectedVersion) => request("/insights/prompt", {
  method: "PUT", body: JSON.stringify({ scope, planning_year: planningYear, text, expected_version: expectedVersion }),
});
export { planningYear };
