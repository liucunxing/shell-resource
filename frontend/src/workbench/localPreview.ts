export interface LocalPreviewConfig {
  defaultEmail: string;
  dataLabel?: string;
  users: { email: string; label: string }[];
}

declare global {
  interface Window {
    __RESOURCE_LOCAL_PREVIEW__?: unknown;
  }
}

export const LOCAL_PREVIEW_EMAIL_KEY = "shell-resource-local-preview-email";

/** Only the synthetic fixture injects this config; ordinary localhost is not a bypass. */
export function getLocalPreviewConfig(): LocalPreviewConfig | null {
  if (typeof window === "undefined" || !window.location) return null;
  const raw = window.__RESOURCE_LOCAL_PREVIEW__;
  if (!raw || typeof raw !== "object") return null;
  let url: URL;
  try {
    url = new URL(window.location.href);
  } catch {
    return null;
  }
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.pathname === "/portal-embed" ||
    url.pathname.startsWith("/portal-embed/")
  )
    return null;
  const config = raw as Partial<LocalPreviewConfig>;
  if (
    !Array.isArray(config.users) ||
    !config.users.length ||
    config.users.length > 100
  )
    return null;
  if (
    !config.users.every(
      (user) =>
        user &&
        typeof user.email === "string" &&
        /^[a-z0-9-]+@example\.test$/.test(user.email) &&
        typeof user.label === "string" &&
        user.label.length <= 80,
    )
  )
    return null;
  if (!config.users.some((user) => user.email === config.defaultEmail))
    return null;
  if (
    config.dataLabel !== undefined &&
    (typeof config.dataLabel !== "string" ||
      !config.dataLabel.trim() ||
      config.dataLabel.length > 80)
  )
    return null;
  return config as LocalPreviewConfig;
}

export function getLocalPreviewEmail(config = getLocalPreviewConfig()): string {
  if (!config) return "";
  try {
    const saved = sessionStorage.getItem(LOCAL_PREVIEW_EMAIL_KEY);
    if (config.users.some((user) => user.email === saved)) return saved!;
  } catch {
    /* Storage restrictions must not block direct local preview. */
  }
  return config.defaultEmail;
}

export function setLocalPreviewEmail(email: string): boolean {
  const config = getLocalPreviewConfig();
  if (!config?.users.some((user) => user.email === email)) return false;
  try {
    sessionStorage.setItem(LOCAL_PREVIEW_EMAIL_KEY, email);
  } catch {
    return false;
  }
  return true;
}
