const fs = require("node:fs");
const path = require("node:path");
const { fillMissingCoverage } = require("./coverage.cjs");

const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
const label = { passed: "通过", failed: "发现问题", blocked: "未测完" };
const key = (r) => JSON.stringify([r.caseId, r.user, r.scope]);
const statuses = new Set(Object.keys(label));

function previousRun(parent, run) {
  if (!run.comparisonKey) return;
  for (const name of fs.readdirSync(parent).sort().reverse()) {
    try {
      const prior = JSON.parse(fs.readFileSync(path.join(parent, name, "results.json"), "utf8"));
      if (
        prior.started < run.started &&
        prior.finished &&
        !prior.error &&
        prior.comparisonKey === run.comparisonKey
      )
        return prior;
    } catch {
      /* Other and incomplete run directories are ineligible. */
    }
  }
}

function writeReport(dir, run, inputs) {
  fillMissingCoverage(run, inputs);
  const defs = new Map(inputs.cases.map((c) => [c.id, c]));
  const rows = run.results;
  const counts = (run.counts = { passed: 0, failed: 0, blocked: 0 });
  for (const row of rows) {
    if (!statuses.has(row.status)) throw new Error("未知结果状态 " + row.status);
    counts[row.status]++;
  }
  const users = run.roster || [];
  const identityId = inputs.cases.find((c) => c.action === "identity-scope")?.id;
  const visited = new Set(
    rows.filter((r) => r.caseId === identityId && r.status === "passed").map((r) => r.user),
  );
  const identityCount = users.filter((u) => visited.has(u.email)).length;
  const done = (c) =>
    rows.some((r) => r.caseId === c.id) &&
    rows.filter((r) => r.caseId === c.id).every((r) => r.status === "passed");
  const prior = previousRun(path.dirname(dir), run);
  const old = new Map();
  for (const r of prior?.results || []) {
    if (!old.has(key(r))) old.set(key(r), []);
    old.get(key(r)).push(r.status);
  }
  const changes = new Map();
  for (const r of rows) {
    const was = old.get(key(r))?.shift();
    if (was && r.status === "failed") changes.set(r, was === "failed" ? "仍存在" : "本轮发现");
    if (was === "failed" && r.status === "passed") changes.set(r, "已复验修复");
  }
  const delta = (r) => changes.get(r) || "";
  run.baseline = prior?.id ?? null;
  const missing =
    run.error ||
    counts.blocked ||
    !users.length ||
    identityCount < users.length ||
    inputs.cases.some((c) => !done(c));
  run.exitCode = counts.failed ? 1 : missing ? 2 : 0;
  run.verdict = ["隔离业务旅程通过", "建议暂缓验收", "验收证据不足"][run.exitCode];
  function evidence(row) {
    const file = row.evidence;
    if (
      typeof file !== "string" ||
      /^(?:[a-z]+:|[\\/])/i.test(file) ||
      file.split(/[\\/]/).includes("..")
    )
      return "";
    if (!fs.existsSync(path.join(dir, file))) return "";
    const href = file.split(/[\\/]/).map(encodeURIComponent).join("/");
    return ' <a href="' + esc(href) + '">查看现场</a>';
  }
  const prettyUser = (email) => users.find((u) => u.email === email)?.name || email || "整套旅程";
  function item(r) {
    const c = defs.get(r.caseId) || {};
    const steps = (c.steps || []).map(esc).join(" → ");
    return (
      "<article><b>" +
      esc(c.title || r.caseId) +
      "</b>　" +
      esc(prettyUser(r.user)) +
      " · " +
      esc(r.scope || "全局") +
      "<p>预期　" +
      esc(r.expected || c.expected) +
      "</p><p>实测　" +
      esc(r.actual) +
      evidence(r) +
      "</p>" +
      (steps ? "<small>复现　" + steps + "</small>" : "") +
      (delta(r) ? "<p>" + delta(r) + "</p>" : "") +
      "</article>"
    );
  }
  const problems = [
    ...rows.filter((r) => r.status === "failed"),
    ...rows.filter((r) => r.status === "blocked"),
  ];
  function details(title, html) {
    return "<details><summary>" + esc(title) + "</summary>" + html + "</details>";
  }
  let main =
    "<header><small>Resource Studio · 部署后业务验收</small><h1>" +
    run.verdict +
    "</h1><p>隔离测试名单 " +
    identityCount +
    " / " +
    users.length +
    " 人已核对身份范围，完整通过 " +
    inputs.cases.filter(done).length +
    " / " +
    inputs.cases.length +
    " 个自动案例。</p></header>";
  main +=
    "<!-- ux-start --><section><p>体验复核待阅。关键操作截图可在各旅程中展开。</p></section><!-- ux-end -->";
  main +=
    "<p>应用提交 <code>" +
    esc(run.release?.target?.slice(0, 12) || "未核实") +
    "</code> · " +
    esc(run.release?.provided ? "与输入的部署提交核对" : "本地检出") +
    " · " +
    esc(
      new Date(run.started).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }),
    ) +
    " 北京时间" +
    "</p><p>" +
    esc(run.deployment || "线上站点本轮未核验") +
    "。本轮业务操作使用临时 SQLite 和测试身份。真实登录另行核验。</p>";
  if (run.error) main += "<article><b>执行受阻</b><p>" + esc(run.error) + "</p></article>";
  if (problems.length) {
    main += "<h2>优先处理</h2>";
    // Count repeated failures without printing a long list on the front page.
    const grouped = new Map();
    for (const r of problems) {
      const id = r.status + ":" + r.caseId;
      if (!grouped.has(id)) grouped.set(id, []);
      grouped.get(id).push(r);
    }
    const first = problems[0];
    const primary = defs.get(first.caseId);
    main +=
      "<article><b>" +
      esc(primary?.title || first.caseId) +
      "</b><p>" +
      esc(
        first.status === "failed"
          ? primary?.impact || first.expected
          : "这段旅程尚缺足够证据，需要复测。",
      ) +
      "</p><p>" +
      esc(prettyUser(first.user)) +
      " · " +
      esc(first.scope) +
      "　" +
      esc(first.actual) +
      evidence(first) +
      "</p></article>";
    for (const group of grouped.values())
      main += details(
        label[group[0].status] +
          " · " +
          (defs.get(group[0].caseId)?.title || group[0].caseId) +
          "（" +
          group.length +
          " 项）",
        group.map(item).join(""),
      );
  }
  const fixed = rows.filter((r) => delta(r) === "已复验修复");
  main +=
    "<p>" +
    (prior
      ? "对比同一输入与抽样条件的 " + esc(prior.id) + "，本轮已复验修复 " + fixed.length + " 项。"
      : "当前输入与抽样条件首次形成对照记录。") +
    "</p>";
  if (fixed.length) main += details("已复验修复", fixed.map(item).join(""));
  main += "<h2>旅程与覆盖</h2>";
  for (const j of inputs.journeys) {
    const matched = rows.filter((r) => j.steps.includes(r.caseId));
    const n = j.steps.filter((id) => defs.has(id) && done(defs.get(id))).length;
    main += details(
      j.title + "　" + n + " / " + j.steps.length + " 个案例通过",
      matched.map(item).join("") || "尚无执行证据",
    );
  }
  main += details(
    "逐人覆盖",
    users
      .map((u) => {
        const tests = rows.filter((r) => r.user === u.email);
        return (
          "<p><b>" +
          esc(u.name) +
          "</b>　" +
          esc(u.role) +
          " · " +
          esc(u.email) +
          "　身份" +
          (visited.has(u.email) ? "已核对" : "待核对") +
          "，通过 " +
          tests.filter((r) => r.status === "passed").length +
          " / " +
          tests.length +
          " 个检查。</p>"
        );
      })
      .join("") || "未取得名单",
  );
  if (inputs.reviewCases?.length)
    main += details(
      "待另行复核（" + inputs.reviewCases.length + " 项）",
      inputs.reviewCases
        .map((c) => "<p><b>" + esc(c.title) + "</b>　" + esc(c.expected) + "</p>")
        .join(""),
    );
  main += details(
    "数据来源与复测参数",
    "<p>" +
      esc(run.rosterSource) +
      " · 抽样参数 " +
      esc(run.seed) +
      " · 案例版本 " +
      esc(inputs.suiteVersion) +
      '</p><a href="results.json">查看结构化结果</a>',
  );
  const css =
    "body{background:#f3f5f4;color:#172724;font:16px/1.6 system-ui,sans-serif;margin:0}main{max-width:890px;margin:auto;padding:28px 5vw 60px}header,article,details{background:white;border:1px solid #d7dfdc;border-radius:8px;padding:12px 18px;margin:10px 0}header{border-top:5px solid #276957}h1{font-size:30px;margin:.2em 0}h2{font-size:20px;margin-top:1.4em}p{margin:.4em 0}summary{font-weight:600;cursor:pointer}a{color:#145d71}small{color:#465b56}article{overflow-wrap:anywhere}";
  fs.writeFileSync(
    path.join(dir, "index.html"),
    '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>资源投资业务验收</title><style>' +
      css +
      "</style><main>" +
      main +
      "</main></html>",
  );
  fs.writeFileSync(path.join(dir, "results.json"), JSON.stringify(run, null, 2));
}
module.exports = { writeReport };
