"use strict";

const {
  verify,
  need,
  btn,
  nav,
  scopeKey,
  amount,
  wan,
  selectVersion,
} = require("./browser-steps.cjs");

async function identityScope(page, user, versionId) {
  const navbar = page.getByRole("navigation", { name: "工作台导航" });
  const labels = {
    owner: ["我的 Initiative", "拆分工作台", "我的投入组合", "草稿与提交"],
    lead: [
      "部门投入组合",
      "部门方案提交",
      ...(user.projects.length
        ? ["我的 Initiative", "拆分工作台", "我的投入组合", "草稿与提交"]
        : []),
    ],
    management: ["全局投资看板"],
    admin: [
      "版本与发布",
      "部门方案与驳回",
      "项目配置",
      "用户与权限",
      "组织与枚举",
      "健康检查阈值",
      "操作审计",
    ],
  };
  const observed = (await navbar.getByRole("button").allTextContents()).map((s) => s.trim()).sort();
  const expected = labels[user.role].slice().sort();
  verify(
    JSON.stringify(expected) === JSON.stringify(observed),
    "导航范围有差异。页面显示 " + observed.join("、") + "。",
  );
  if (user.role === "owner" || (user.role === "lead" && user.projects.length)) {
    await nav(page, "我的 Initiative").click();
    await page.locator(".v19-home").waitFor();
    await selectVersion(page, versionId);
    const visible = [];
    const cap = Math.max(1, Math.ceil(user.projects.length / 9)) + 1;
    for (let i = 0; i < cap; i++) {
      visible.push(...(await page.locator(".v19-initiative-card h2").allTextContents()));
      const next = btn(page.locator(".v19-list-pagination"), "下一页");
      if (!(await next.isEnabled())) break;
      verify(i + 1 < cap, "本人项目页数超出名单预期，可能存在额外可见项目。");
      await next.click();
    }
    verify(
      JSON.stringify(visible.sort()) === JSON.stringify(user.projects.map((p) => p.name).sort()),
      "本人项目范围不匹配，页面项目：" + visible.join("、"),
    );
  }
  return (
    "已核对个人信息中的账号、角色导航" +
    (user.projects.length ? "及本人 " + user.projects.length + " 个项目" : "") +
    "。"
  );
}
async function departmentPage(page, g, versionId) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await nav(page, "部门方案提交").click();
  await page.getByRole("heading", { name: "部门方案提交", exact: true }).waitFor();
  await page.getByLabel("规划版本", { exact: true }).waitFor();
  await selectVersion(page, versionId);
  const scope = page.getByLabel("查看范围");
  if (await scope.count()) {
    const options = await scope.locator("option").evaluateAll((els) => els.map((o) => o.value));
    const key = options.find(
      (v) => v.toUpperCase() === [g.sector, g.department].join("|").toUpperCase(),
    );
    verify(key, "负责人的查看范围缺少 " + g.key + "。");
    if ((await scope.inputValue()) !== key) await scope.selectOption(key);
  }
  need(g.items.length, "此部门没有可测试的启用项目。");
  const rows = page.locator(".v20-review-scroll tbody tr");
  await rows.filter({ has: page.getByText(g.items[0].name, { exact: true }) }).waitFor();
  const names = await rows.locator("td:first-child strong").allTextContents();
  verify(
    JSON.stringify(names.sort()) === JSON.stringify(g.items.map((p) => p.name).sort()),
    "部门项目范围与验收名单不同，页面列出 " + names.join("、") + "。",
  );
  return rows;
}
async function departmentIncomplete(page, g, versionId) {
  const rows = await departmentPage(page, g, versionId);
  verify(await btn(page, "提交部门方案至管理层").isDisabled(), "有未提交项目时仍可确认部门方案。");
  const statuses = await rows.locator("td:nth-child(3)").allTextContents();
  verify(statuses.includes("未提交"), "负责人看不到尚未提交的项目状态。");
  const owners = await rows.locator("td:nth-child(2)").allTextContents();
  verify(
    owners.every((v) => v.trim() && v !== "—"),
    "有项目没有显示应联系的 Owner。",
  );
  return "齐交前禁止提交，页面列出 " + statuses.length + " 项及对应 Owner。";
}
async function departmentTransition(page, g, versionId, action, ledger) {
  const rows = await departmentPage(page, g, versionId);
  const confirm = action === "confirm";
  const button = btn(page, confirm ? "提交部门方案至管理层" : "撤回部门提交");
  verify(
    await button.isEnabled(),
    "满足业务前提后，" + (confirm ? "部门确认" : "部门撤回") + "按钮仍不可用。",
  );
  if (confirm) {
    for (const p of g.items) {
      const row = rows.filter({ has: page.getByText(p.name, { exact: true }) });
      verify(
        (await row.locator("td").nth(2).innerText()).trim() === "已提交",
        p.name + " 在负责人列表中未显示已提交。",
      );
      const got = amount(await row.locator("td").last().innerText()),
        want = wan(ledger.get(p.id).invest);
      verify(got === want, p.name + " 部门列表应显示 " + want + " 万元，实际 " + got + " 万元。");
    }
  }
  await button.click();
  const dialog = page.getByRole("dialog");
  if (!confirm) await dialog.getByRole("textbox").fill("业务验收：本部门调整分配。");
  await btn(dialog, "确认").click();
  await dialog.waitFor({ state: "hidden" });
  await page
    .getByRole("heading", {
      name: confirm ? "部门已提交管理层" : "部门尚未提交管理层",
      exact: true,
    })
    .waitFor();
  verify(await button.isDisabled(), "提交状态改变后原操作按钮仍可用。");
  return confirm
    ? "部门已确认 " + g.items.length + " 项，逐项核对最新提交金额。"
    : "本部门撤回成功，已确认标识解除。";
}
async function managementPage(page, projects, ledger, confirmed, versionId) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await nav(page, "全局投资看板").click();
  await selectVersion(page, versionId);
  const panel = page.locator(".v19-subpanel").filter({
    has: page.getByRole("heading", { name: "预算去向", exact: true }),
  });
  await panel.locator(".v19-budget-donut strong").waitFor();
  const expectedBudget = projects.reduce((s, p) => s + p.budgetCny, 0);
  const inScope = projects.filter((p) => confirmed.has(scopeKey(p)));
  const expectedInvest = inScope.reduce((s, p) => s + ledger.get(p.id).invest, 0);
  const check = async (rows, budget, invest) => {
    const seenBudget = amount(await panel.locator(".v19-budget-donut strong").innerText());
    const investLine = panel
      .locator(".v19-budget-legend > div")
      .filter({ has: page.getByText("已分配到经销商", { exact: true }) });
    const seenInvest = amount(await investLine.locator("strong").innerText());
    verify(
      seenBudget === wan(budget) && seenInvest === wan(invest),
      rows +
        "预期预算 " +
        wan(budget) +
        "、已确认分配 " +
        wan(invest) +
        " 万元，页面分别显示 " +
        seenBudget +
        "、" +
        seenInvest +
        " 万元。",
    );
  };
  await check("当前版本合计", expectedBudget, expectedInvest);
  // Check the component departments independently. An equal overcount and undercount could cancel in the total.
  const filters = page.getByRole("group", { name: "管理层筛选" });
  const sector = filters.getByLabel("Sector", { exact: true }),
    dept = filters.getByLabel("部门", { exact: true });
  for (const key of new Set(projects.map(scopeKey))) {
    const subset = projects.filter((p) => scopeKey(p) === key);
    await selectCaseInsensitive(sector, subset[0].sector);
    await selectCaseInsensitive(dept, subset[0].department);
    await check(
      key,
      subset.reduce((s, p) => s + p.budgetCny, 0),
      confirmed.has(key) ? subset.reduce((s, p) => s + ledger.get(p.id).invest, 0) : 0,
    );
  }
  await sector.selectOption("all");
  await dept.selectOption("all");
  return (
    "预算 " +
    expectedBudget.toLocaleString("zh-CN") +
    " 元，已确认经销商投入 " +
    expectedInvest.toLocaleString("zh-CN") +
    " 元。已核对看板万元展示及各部门拆分。"
  );
}
async function selectCaseInsensitive(locator, value) {
  const values = await locator.locator("option").evaluateAll((els) => els.map((el) => el.value));
  const chosen = values.find((v) => v.toUpperCase() === value.toUpperCase());
  verify(chosen, "看板筛选缺少 " + value + "。");
  await locator.selectOption(chosen);
}
module.exports = {
  identityScope,
  departmentPage,
  departmentIncomplete,
  departmentTransition,
  managementPage,
};
