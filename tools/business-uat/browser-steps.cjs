"use strict";

class Mismatch extends Error {}
class Blocked extends Error {}
function verify(condition, message) {
  if (!condition) throw new Mismatch(message);
}
function need(condition, message) {
  if (!condition) throw new Blocked(message);
}

const btn = (page, name) => page.getByRole("button", { name, exact: typeof name === "string" });
const tab = (page, name) => page.getByRole("tab", { name, exact: true });
const nav = (page, name) => btn(page.getByRole("navigation", { name: "工作台导航" }), name);
const scopeKey = (row) =>
  [row.sector, row.department].map((x) => String(x).trim().toUpperCase()).join(" / ");
const amount = (text) =>
  Number(
    String(text)
      .replaceAll(",", "")
      .match(/-?\d+(?:\.\d+)?/)?.[0] ?? NaN,
  );
const wan = (value) =>
  Number(
    (value / 10000).toLocaleString("en-US", {
      useGrouping: false,
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }),
  );
const step = (page, n) => tab(page, ["预算与预留", "经销商范围", "试算、微调与提交"][n - 1]);
const moneyInputs = (page) => page.locator('input[aria-label$=" 分配金额"]');
const readyEditor = (page) => page.locator('.v19-editor[aria-busy="false"]').waitFor();
async function submitInput(input, value) {
  await input.fill(String(value));
  await input.press("Tab");
  verify(amount(await input.inputValue()) === value, "金额输入框没有保留输入的 " + value + " 元。");
}
async function goStep(page, n) {
  const target = step(page, n);
  if ((await target.getAttribute("aria-selected")) !== "true") await target.click();
  await page
    .getByRole("tab", {
      name: await target.innerText(),
      selected: true,
      exact: true,
    })
    .waitFor();
  await readyEditor(page);
}
async function newSession(browser, baseURL, user) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 950 },
    locale: "zh-CN",
  });
  try {
    const page = await ctx.newPage();
    page.setDefaultTimeout(6000);
    await page.goto(baseURL, { waitUntil: "domcontentloaded" });
    const selector = page.getByRole("combobox", {
      name: "本地测试角色（合成数据）",
    });
    await selector.waitFor();
    await selector.selectOption(user.email);
    const roleText = {
      owner: "Initiative Owner",
      lead: "部门负责人",
      management: "最高管理层",
      admin: "系统管理员",
    }[user.role];
    need(roleText, "身份不在当前应用的四种角色范围内。");
    await btn(page, user.name + "，" + roleText + "，查看个人信息").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText(user.email, { exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    return { ctx, page };
  } catch (e) {
    await ctx.close();
    throw e;
  }
}
async function selectVersion(page, id) {
  const select = page.getByLabel("规划版本", { exact: true });
  if ((await select.count()) && (await select.inputValue()) !== String(id)) {
    await select.selectOption(String(id));
    await page.waitForFunction(
      (id) => document.querySelector('[aria-label="规划版本"]')?.value === id,
      String(id),
    );
  }
}
async function projectCard(page, project) {
  const card = page.locator(".v19-initiative-card").filter({
    has: page.getByRole("heading", { name: project.name, exact: true }),
  });
  const maxPages = Math.max(
    1,
    Math.ceil(
      (Number.parseInt(await page.locator(".v19-list-pagination > span").innerText(), 10) || 0) / 9,
    ),
  );
  const prev = btn(page.locator(".v19-list-pagination"), "上一页");
  for (let i = 1; i < maxPages && !(await card.count()) && (await prev.isEnabled()); i++)
    await prev.click();
  for (let i = 1; i < maxPages && !(await card.count()); i++) {
    const next = btn(page.locator(".v19-list-pagination"), "下一页");
    verify(await next.isEnabled(), "Owner 的项目列表缺少「" + project.name + "」。");
    await next.click();
  }
  verify((await card.count()) === 1, "Owner 的项目列表缺少或重复显示「" + project.name + "」。");
  return card;
}
async function openProject(page, project, versionId) {
  await nav(page, "我的 Initiative").click();
  await page.locator(".v19-home").waitFor();
  await selectVersion(page, versionId);
  const card = await projectCard(page, project);
  await btn(card, /进入拆分/).click();
  await page.getByRole("heading", { name: project.name, exact: true, level: 1 }).waitFor();
  await readyEditor(page);
  verify(
    (await page.locator(".v19-work-version").innerText()).includes(versionId),
    "工作台打开了其他版本。",
  );
}
async function totals(page) {
  return (await page.locator(".v19-work-budget-cards strong").allTextContents()).map(amount);
}
async function checkTotals(page, expected) {
  const found = await totals(page);
  verify(
    expected.every((v, i) => v === found[i]),
    "预算 / 预留 / 已分配 / 待分配应为 " +
      expected.join(" / ") +
      " 元，页面显示 " +
      found.join(" / ") +
      " 元。",
  );
}
async function acknowledge(page) {
  const box = page.getByRole("checkbox", { name: /已核对本版预算与预留/ });
  if ((await box.isEnabled()) && (await box.getAttribute("aria-checked")) !== "true")
    await box.click();
}
async function pick(page, index) {
  const table = page.locator("table.v19-scope-review");
  const row = table.locator("tbody tr").nth(index);
  const box = row.getByRole("checkbox");
  need(await box.count(), "此业务线缺少测试所需的 Active 经销商。");
  verify(
    (await box.getAttribute("aria-checked")) === "false",
    "准备新增的经销商已经入选，起始数据与用例不符。",
  );
  const cells = row.locator("td");
  const headers = await table.locator("thead tr").first().locator("th").allTextContents();
  const statusIndex = headers.findIndex((label) => label.trim() === "状态");
  need(statusIndex >= 0, "候选表中没有可识别的经销商状态列。");
  verify(
    /^(active|1|启用|有效|激活)$/i.test((await cells.nth(statusIndex).innerText()).trim()),
    "候选表出现未启用的经销商。",
  );
  verify(await box.isEnabled(), "已启用的候选经销商无法选入当前方案。");
  await box.click();
  return (await box.getAttribute("aria-label")).slice("选择 ".length);
}
function moneyRow(page, dealer) {
  return page.getByLabel(dealer + " 分配金额", { exact: true });
}
async function save(page) {
  await btn(page, "保存草稿").click();
  await page
    .getByText("草稿已保存", { exact: false })
    .first()
    .waitFor({ timeout: 900 })
    .catch(() => {});
  await readyEditor(page);
}
async function inspectSubmitFeedback(page) {
  const [, , , remaining] = await totals(page);
  const submit = btn(page, /^提交到 /);
  need(remaining > 0 && (await submit.isDisabled()), "未进入有待分配金额且提交被禁用的测试状态。");
  const label = page.locator(".save-bar .save-label strong");
  await label.waitFor();
  const wording = (await label.innerText()).trim();
  const observation =
    "待分配 " +
    remaining.toLocaleString("zh-CN") +
    " 元，提交按钮已禁用，保存状态显示「" +
    wording +
    "」。";
  // An explicit, unconditional promise conflicts with the button. Conditional instructions
  // such as “配平后可以提交” explain what the owner still has to do.
  const promisesSubmission =
    /(?:^|[，,；;。！!：:])\s*(?:现在|当前)?(?:可以|可直接|可立即|可)提交(?:当前方案|方案|本项目)?[。！!]?$/u.test(
      wording,
    );
  verify(!promisesSubmission, observation + "用户会误以为已具备提交条件。");
  return observation;
}
async function publish(page, project) {
  const button = btn(page, /^提交到 /);
  verify(await button.isEnabled(), "预算已配平，提交按钮仍不可用。");
  await button.click();
  await page.locator(".v19-home").waitFor();
  const card = await projectCard(page, project);
  verify((await card.innerText()).includes("已提交"), "提交后项目卡没有显示已提交。");
}
async function allocate(page, p, versionId, onHalfAllocated) {
  need(p.budgetCny >= 4, "该项目预算不足 4 元，无法同时验证预留、部分分配与剩余差额。");
  await openProject(page, p, versionId);
  await goStep(page, 1);
  await checkTotals(page, [p.budgetCny, 0, 0, p.budgetCny]);
  await btn(page, /添加预留/).click();
  const reserve = Math.max(1, Math.floor(p.budgetCny / 10));
  await submitInput(page.getByLabel("第 1 项安排金额"), reserve);
  await acknowledge(page);
  await goStep(page, 2);
  const paid = await pick(page, 0),
    zero = await pick(page, 1);
  await goStep(page, 3);
  const invest = p.budgetCny - reserve;
  await submitInput(moneyRow(page, paid), Math.floor(invest / 2));
  verify(await btn(page, /^提交到 /).isDisabled(), "金额有差额时提交按钮仍可用。");
  const hint = page.locator('[aria-label^="无法提交"]');
  verify(
    (await hint.count()) && (await hint.getAttribute("aria-label")).length > 6,
    "未配平时缺少可读取的提交原因。",
  );
  if (onHalfAllocated) return onHalfAllocated({ reserve, invest, paid, zero });
  await submitInput(moneyRow(page, paid), invest);
  await checkTotals(page, [p.budgetCny, reserve, invest, 0]);
  verify(amount(await moneyRow(page, zero).inputValue()) === 0, "已选零金额经销商在拆分表中丢失。");
  await publish(page, p);
  return { reserve, invest, paid, zero };
}
async function backtrack(page, p, state, versionId, midpoint) {
  const half = Math.floor(state.invest / 2);
  await save(page);
  await checkTotals(page, [p.budgetCny, state.reserve, half, p.budgetCny - state.reserve - half]);
  await midpoint();
  await goStep(page, 1);
  const headroom = p.budgetCny - state.reserve - half;
  const adjustment = Math.min(1000, Math.floor(headroom / 2));
  need(adjustment > 0, "半额草稿中没有足够余量用于新增和修改预留。");
  const reserve = state.reserve + adjustment;
  await submitInput(page.getByLabel("第 1 项安排金额"), reserve);
  await btn(page, /添加预留/).click();
  await submitInput(page.getByLabel("第 2 项安排金额"), Math.min(100, headroom - adjustment));
  await btn(page, "移除第 2 项预算安排").click();
  verify((await page.getByLabel("第 2 项安排金额").count()) === 0, "移除的预留仍显示在表格。");
  await acknowledge(page);
  await goStep(page, 2);
  await page.getByRole("checkbox", { name: "选择 " + state.zero, exact: true }).click();
  const replacement = await pick(page, 2);
  await goStep(page, 3);
  await page.reload({ waitUntil: "domcontentloaded" });
  await openProject(page, p, versionId);
  await goStep(page, 3);
  await checkTotals(page, [p.budgetCny, reserve, half, p.budgetCny - reserve - half]);
  verify(
    (await moneyInputs(page).count()) === 2 && (await moneyRow(page, state.zero).count()) === 0,
    "刷新后经销商名单与最终选择不一致。",
  );
  verify(
    amount(await moneyRow(page, replacement).inputValue()) === 0,
    "刷新后新增零金额经销商未正确保留。",
  );
  const invest = p.budgetCny - reserve;
  await submitInput(moneyRow(page, state.paid), invest);
  await publish(page, p);
  return { ...state, reserve, invest, zero: replacement };
}
async function revise(page, p, state, versionId, checkDraft) {
  await openProject(page, p, versionId);
  await goStep(page, 3);
  const adjustment = Math.min(10000, Math.max(1, Math.floor(state.invest / 3)));
  const target = state.invest - adjustment;
  need(target > 0, "没有足够金额执行重提用例。");
  await submitInput(moneyRow(page, state.paid), target);
  await goStep(page, 1);
  const reserve = state.reserve + adjustment;
  await submitInput(page.getByLabel("第 1 项安排金额"), reserve);
  await acknowledge(page);
  await goStep(page, 3);
  await save(page);
  await nav(page, "我的 Initiative").click();
  await page.locator(".v19-home").waitFor();
  const card = await projectCard(page, p);
  verify(!/已提交 · 待确认|已确认/.test(await card.innerText()), "修改保存后，项目仍显示已提交。");
  if (checkDraft) await checkDraft();
  await openProject(page, p, versionId);
  await goStep(page, 3);
  await checkTotals(page, [p.budgetCny, reserve, target, 0]);
  await publish(page, p);
  return { ...state, reserve, invest: target };
}
module.exports = {
  Mismatch,
  Blocked,
  verify,
  need,
  btn,
  nav,
  scopeKey,
  amount,
  wan,
  newSession,
  selectVersion,
  openProject,
  goStep,
  pick,
  allocate,
  inspectSubmitFeedback,
  backtrack,
  revise,
};
