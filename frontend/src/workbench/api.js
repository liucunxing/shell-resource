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
export const updateConfig = (value) => request("/admin/config", {
  method: "PUT", body: JSON.stringify(value),
});
export const uploadReference = (value) => request("/admin/reference", {
  method: "POST", body: JSON.stringify(value),
});
export const getInsights = (scope) => request(`/insights?scope=${encodeURIComponent(scope)}&planning_year=${planningYear}`);
export const generateInsights = (scope) => request("/insights/generate", {
  method: "POST", body: JSON.stringify({ scope, planning_year: planningYear }),
});
export const saveInsightPrompt = (scope, text, expectedVersion) => request("/insights/prompt", {
  method: "PUT", body: JSON.stringify({ scope, planning_year: planningYear, text, expected_version: expectedVersion }),
});
export { planningYear };
