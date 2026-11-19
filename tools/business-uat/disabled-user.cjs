"use strict";

const { need, verify } = require("./browser-steps.cjs");

// Verify refusal on the same read-only workspace URL that the application
// successfully loads. This is a local permission check, not a login attempt.
async function verifyDisabledUser(browser, sandbox, user) {
  const origin = new URL(sandbox.baseUrl);
  need(
    origin.protocol === "http:" && origin.hostname === "127.0.0.1" && sandbox.runId,
    "停用身份检查需要本轮已核验的回环沙箱。",
  );
  need(
    user.enabled === false && user.email.endsWith("@example.test"),
    "只支持核对本轮名单中的停用合成身份。",
  );
  const ctx = await browser.newContext({ locale: "zh-CN" });
  try {
    const page = await ctx.newPage();
    const [baseline, entry] = await Promise.all([
      page.waitForResponse(
        (response) => {
          const url = new URL(response.url());
          return (
            url.origin === origin.origin &&
            url.pathname === "/api/v1/workbench/workspace" &&
            response.request().method() === "GET" &&
            response.ok()
          );
        },
        { timeout: 15000 },
      ),
      page.goto(origin.origin, { waitUntil: "domcontentloaded" }),
    ]);
    need(
      entry &&
        (await entry.headerValue("x-uat-run-id")) === sandbox.runId &&
        (await baseline.headerValue("x-uat-run-id")) === sandbox.runId,
      "未取得当前隔离应用及可用工作台读取入口的证据。",
    );
    const selector = page.getByRole("combobox", { name: "本地测试角色（合成数据）" });
    await selector.waitFor({ timeout: 6000 });
    const choices = await selector
      .locator("option")
      .evaluateAll((nodes) => nodes.map((node) => node.value));
    need(choices.length > 0, "本轮没有可用的测试身份选择器。");
    verify(!choices.includes(user.email), "停用身份仍可在用户选择器中选到。");

    const result = await page.evaluate(
      async ({ url, email }) => {
        const response = await fetch(url, {
          method: "GET",
          credentials: "omit",
          redirect: "error",
          headers: { "X-User-Email": email },
        });
        const body = await response.json();
        return {
          status: response.status,
          code: body.code,
          empty: body.data === null,
          runId: response.headers.get("x-uat-run-id"),
        };
      },
      { url: baseline.url(), email: user.email },
    );
    need(result.runId === sandbox.runId, "权限结果未绑定到当前隔离实例。");
    verify(
      result.status === 403 && result.code === 403 && result.empty,
      "停用合成身份读取工作台应返回 403 且无业务数据，实际 HTTP " + result.status + "。",
    );
    return "已验证停用身份被拒绝。角色选择器不提供此人，工作台只读入口返回 403 且无业务数据。";
  } finally {
    await ctx.close();
  }
}

module.exports = { verifyDisabledUser };
