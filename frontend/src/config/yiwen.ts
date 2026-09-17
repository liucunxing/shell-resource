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
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && local)) {
    return { url: "", error: "易问地址须使用 HTTPS，本机调试可使用 HTTP。" };
  }

  return { url: parsed.href, error: null };
}
