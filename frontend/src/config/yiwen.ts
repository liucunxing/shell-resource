export function parseYiwenUrl(raw?: string): {
  url: string;
  error: string | null;
} {
  const value = raw?.trim() ?? "";
  if (!value) return { url: "", error: null };

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { url: "", error: "易问地址格式不正确，请检查配置。" };
  }

  if (parsed.username || parsed.password) {
    return { url: "", error: "易问地址不能包含用户名或密码。" };
  }

  const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  const internalTest = parsed.origin === "http://dataaitest.digitalshell.com.cn:3052";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && (local || internalTest))) {
    return { url: "", error: "易问地址须使用 HTTPS，仅本机或指定内部测试地址可使用 HTTP。" };
  }

  return { url: parsed.href, error: null };
}

export function buildYiwenUrl(raw?: string, email?: string) {
  const config = parseYiwenUrl(raw);
  if (!config.url) return config;
  const normalized = email?.trim().toLowerCase() || "";
  if (!normalized || normalized.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return { url: "", error: "请先使用已配置权限的邮箱登录工作台。" };
  }
  const url = new URL(config.url);
  // Replace configured/stale identities; do not send roles or other workspace data.
  for (const key of [...url.searchParams.keys()]) {
    if (key.trim() === "user_email") url.searchParams.delete(key);
  }
  url.searchParams.set("user_email", normalized);
  return { url: url.href, error: null };
}
