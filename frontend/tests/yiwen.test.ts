import { describe, expect, it } from "vitest";
import { parseYiwenUrl } from "../src/config/yiwen";

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
