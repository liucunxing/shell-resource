import { describe, expect, it } from "vitest";
import { buildYiwenUrl, parseYiwenUrl } from "../src/config/yiwen";

describe("易问嵌入地址", () => {
  it.each([undefined, "", "   "])("空配置不生成地址：%s", (value) => {
    expect(parseYiwenUrl(value)).toEqual({ url: "", error: null });
  });

  it("接受 HTTPS 并保留路径、查询与片段", () => {
    expect(
      parseYiwenUrl("  https://yiwen.example.com/ask?view=chat#start  "),
    ).toEqual({
      url: "https://yiwen.example.com/ask?view=chat#start",
      error: null,
    });
  });

  it.each([
    "http://localhost:4173/ask",
    "http://127.0.0.1:8080/",
    "http://[::1]:8080/",
  ])("允许本机 HTTP：%s", (url) => {
    expect(parseYiwenUrl(url)).toEqual({ url, error: null });
  });

  it.each([
    "http://yiwen.example.com/",
    "http://dataaitest.digitalshell.com.cn:3052/",
    "http://dataaitest.digitalshell.com.cn:3053/",
    "http://dataaitest.digitalshell.com.cn.evil.example:3052/",
    "http://localhost.example.com/",
    "http://127.0.0.1.example.com/",
    "http://192.168.1.1/",
    "javascript:alert(1)",
    "data:text/html,hello",
    "file:///tmp/yiwen.html",
    "ftp://localhost/",
    "//yiwen.example.com/",
    "/ask",
    "invalid address",
    "https://",
    "https://user:password@yiwen.example.com/",
    "https://user@yiwen.example.com/",
    "https://:password@yiwen.example.com/",
  ])("拒绝不支持或含凭据的地址：%s", (value) => {
    const result = parseYiwenUrl(value);
    expect(result.url).toBe("");
    expect(result.error).toBeTruthy();
  });
});

describe("Data Agent 邮箱透传", () => {
  const base = "https://dataaitest.digitalshell.com.cn/";
  it("uses the authenticated identity and replaces every stale email", () => {
    const result = buildYiwenUrl(base + "?view=chat&user_email=old@example.com&%20user_email=other@example.com#start", " LUKX1@digitalchina.com ");
    expect(result).toEqual({url: base + "?view=chat&user_email=lukx1%40digitalchina.com#start", error: null});
  });
  it("encodes plus addressing without turning it into a space", () => {
    const result = buildYiwenUrl(base, "a+test@example.com");
    expect(new URL(result.url).searchParams.get("user_email")).toBe("a+test@example.com");
  });
  it.each([undefined, "", "invalid", "a\r\n@example.com"])("does not load an unauthenticated iframe: %s", (email) => {
    expect(buildYiwenUrl(base, email).url).toBe("");
    expect(buildYiwenUrl(base, email).error).toBeTruthy();
  });
  it("preserves empty configuration and rejects unsafe URLs", () => {
    expect(buildYiwenUrl("", "a@example.com")).toEqual({url:"", error:null});
    expect(buildYiwenUrl("javascript:alert(1)", "a@example.com").url).toBe("");
  });
});
