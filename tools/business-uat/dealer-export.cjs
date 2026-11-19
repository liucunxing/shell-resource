"use strict";

const path = require("node:path");
const { verify, need, btn, openProject, goStep, amount } = require("./browser-steps.cjs");

function checkRows(actual, expected, where) {
  verify(
    actual.length === expected.length,
    where + "应有 " + expected.length + " 行，实际 " + actual.length + " 行。",
  );
  for (const item of expected) {
    const matching = actual.filter((row) => row.code === item.code);
    verify(matching.length === 1, where + "缺少或重复经销商 " + item.code + "。");
    const row = matching[0];
    verify(
      row.name === item.name && row.amount === item.amount,
      where +
        "经销商 " +
        item.code +
        " 应为 " +
        item.name +
        "、" +
        item.amount +
        " 元，实际为 " +
        row.name +
        "、" +
        row.amount +
        " 元。",
    );
  }
}

async function selectedRows(page, state) {
  const rows = page.getByRole("table", { name: "已选经销商名单", exact: true }).locator("tbody tr");
  verify((await rows.count()) === 2, "本项目最终名单应含一笔有金额和一笔零金额分配。");
  const result = [];
  for (const row of await rows.all()) {
    const cells = row.locator("td");
    const label = await row.getByRole("button", { name: /^移除 / }).getAttribute("aria-label");
    const candidate = label.slice("移除 ".length);
    verify(
      candidate === state.paid || candidate === state.zero,
      "最终名单出现了未勾选的经销商 " + candidate + "。",
    );
    const expected = candidate === state.paid ? state.invest : 0;
    const value = amount(await cells.nth(5).innerText());
    verify(value === expected, "最终名单的分配应为 " + expected + " 元，实际 " + value + " 元。");
    verify((await cells.nth(4).innerText()).trim() === "Active", "最终名单包含非 Active 经销商。");
    result.push({
      code: (await cells.nth(0).innerText()).trim(),
      name: (await cells.nth(1).innerText()).trim(),
      amount: expected,
      candidate,
    });
  }
  verify(new Set(result.map((row) => row.candidate)).size === 2, "同一经销商在最终名单出现两次。");
  return result;
}

async function splitRows(page) {
  const amounts = page.locator('.v19-allocation-table tbody input[aria-label$=" 分配金额"]');
  const result = [];
  for (const input of await amounts.all()) {
    const row = input.locator("xpath=ancestor::tr");
    result.push({
      code: (await row.locator('td[data-column="code"]').innerText()).trim(),
      name: (await row.locator('td[data-column="name"]').innerText()).trim(),
      amount: amount(await input.inputValue()),
    });
  }
  return result;
}

async function compareDownload(page, button, sheetName, expected, project, versionId) {
  // Read Chromium's actual download; application export helpers never participate in the comparison.
  const pending = page.waitForEvent("download", { timeout: 20000 });
  const [download] = await Promise.all([pending, button.click()]);
  const stream = await download.createReadStream();
  need(stream, "浏览器无法读取下载的 Excel。");
  const parts = [];
  for await (const part of stream) parts.push(part);
  const Excel = require(
    require.resolve("exceljs", { paths: [path.resolve(__dirname, "../../frontend")] }),
  );
  const workbook = new Excel.Workbook();
  await workbook.xlsx.load(Buffer.concat(parts));
  const sheet = workbook.getWorksheet(sheetName);
  verify(sheet, "导出文件缺少工作表「" + sheetName + "」。");
  verify(
    sheet.getCell(1, 1).value === "经销商编码" && sheet.getCell(1, 2).value === "经销商名称",
    "导出文件缺少经销商编码或名称列。",
  );
  const isAllocation = sheetName === "经销商分配";
  verify(
    sheet.getCell(1, 6).value === (isAllocation ? "分配金额" : "已分配（元）"),
    "导出文件金额列或单位有误。",
  );
  if (isAllocation) {
    const metadata = JSON.parse(sheet.getCell("I1").value);
    verify(
      String(metadata.id) === String(project.id) &&
        String(metadata.versionId) === String(versionId) &&
        metadata.fields[2] === project.sector,
      "金额模板的项目、规划版本或业务线与正在验收的项目不一致。",
    );
  }
  const actual = [];
  sheet.eachRow((row, n) => {
    if (n === 1) return;
    verify(
      /^(active|1|启用|有效|激活)$/i.test(String(row.getCell(isAllocation ? 3 : 5).value)),
      "导出的名单包含非 Active 经销商。",
    );
    const money = row.getCell(6).value;
    verify(
      typeof money === "number" && Number.isFinite(money),
      "导出金额必须是 Excel 数值，零元也须保留。",
    );
    actual.push({
      code: String(row.getCell(1).value),
      name: String(row.getCell(2).value),
      amount: money,
    });
  });
  checkRows(actual, expected, sheetName + "工作表");
}

async function checkDealerExport(page, project, state, versionId) {
  await openProject(page, project, versionId);
  await goStep(page, 2);
  const baseline = await selectedRows(page, state);
  await compareDownload(
    page,
    btn(page, "下载名单 Excel"),
    "已选经销商",
    baseline,
    project,
    versionId,
  );
  await goStep(page, 3);
  checkRows(await splitRows(page), baseline, "拆分表");
  const trial = btn(page, "按Actual Delivery Vol采用");
  await trial.click();
  if (await page.getByText(/历史权重合计为 0/).isVisible())
    need(false, "所选经销商缺少有效 Vol，无法核对采用试算后的结果。");
  verify(
    (await trial.getAttribute("aria-pressed")) === "true",
    "点击采用 Vol 后没有进入已采用状态。",
  );
  const adopted = await splitRows(page);
  verify(
    adopted.every((row) => Number.isFinite(row.amount) && row.amount >= 0) &&
      adopted.reduce((sum, row) => sum + row.amount, 0) === state.invest,
    "试算金额未配平可分配预算。",
  );
  checkRows(
    adopted.map((row) => ({ ...row, amount: 0 })),
    baseline.map((row) => ({ ...row, amount: 0 })),
    "试算明细",
  );
  const saved = page.waitForResponse(
    (r) => r.request().method() !== "GET" && new URL(r.url()).pathname.endsWith("/draft"),
  );
  const [response] = await Promise.all([saved, btn(page, "保存草稿").click()]);
  verify(response.ok(), "保存试算草稿失败。");
  await page.reload({ waitUntil: "domcontentloaded" });
  await openProject(page, project, versionId);
  await goStep(page, 3);
  checkRows(await splitRows(page), adopted, "保存后重开的试算明细");
  verify((await trial.getAttribute("aria-pressed")) === "true", "刷新后没有恢复刚才保存的试算。");
  await trial.click();
  checkRows(await splitRows(page), baseline, "撤销试算后的分配");
  await compareDownload(
    page,
    btn(page, /完整金额Excel/),
    "经销商分配",
    baseline,
    project,
    versionId,
  );
  await btn(page, /^提交到 /).click();
  await page.locator(".v19-home").waitFor();
  return "两家经销商逐行核对成功。Vol 试算保存后重开金额一致，撤销后恢复原金额。名单 Excel 和完整金额 Excel 均含零元行，项目与版本一致。";
}

module.exports = { checkDealerExport };
