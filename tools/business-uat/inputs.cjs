const fs = require("node:fs");
const path = require("node:path");
const { root } = require("./release.cjs");

const folder = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, "uat-inputs/resource-studio");
const read = (name) =>
  JSON.parse(fs.readFileSync(path.join(folder, name), "utf8").replace(/^\uFEFF/, ""));
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const list = (rows) => "<ol>" + rows.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ol>";
const suite = read("cases.json");
const roster = read("roster.json");
const roles = { owner: "Owner", lead: "部门负责人", management: "管理层", admin: "管理员" };
const name = (role) => roles[role] ?? role;
const cases = new Map(suite.cases.map((c) => [c.id, c]));
let html =
  "<small>Resource Studio / 业务方审阅</small><h1>本轮想验什么</h1><p>" +
  suite.journeys.length +
  " 段用户旅程，" +
  cases.size +
  " 个自动案例，" +
  roster.users.length +
  " 个合成测试身份。展开案例可以核对动作和通过条件。</p>";
html += "<h2>参加人员</h2><table><tr><th>测试身份</th><th>职责</th><th>归属</th></tr>";
for (const u of roster.users)
  html +=
    "<tr><td>" +
    esc(u.name) +
    "</td><td>" +
    esc(name(u.role)) +
    "</td><td>" +
    esc([u.home.sector, u.home.department].join(" / ")) +
    "</td></tr>";
html += "</table>";
for (const j of suite.journeys) {
  html += "<h2>" + esc(j.title) + "</h2>";
  for (const id of j.steps) {
    const c = cases.get(id);
    html +=
      "<details><summary>" +
      esc(c.title) +
      "</summary><p>" +
      esc(c.actors.map(name).join("、")) +
      " · <code>" +
      esc(c.id) +
      "</code></p>" +
      list(c.steps) +
      "<p><b>通过条件　</b>" +
      esc(c.expected) +
      "</p></details>";
  }
}
html +=
  "<h2>另行核验</h2>" +
  suite.reviewCases
    .map((c) => "<p><b>" + esc(c.title) + "</b>　" + esc(c.expected) + "</p>")
    .join("");
const dir = path.join(root, "outputs/business-uat-inputs");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, "index.html");
const css =
  "body{max-width:900px;margin:32px auto;padding:0 5vw 48px;color:#132c28;font:16px/1.65 system-ui,sans-serif}h1{font-size:32px;margin-top:0}h2{font-size:21px;margin:1.3em 0 .5em}details{padding:10px 0;border-bottom:1px solid #cedad7}summary{cursor:pointer;font-weight:600}table{border-collapse:collapse;width:100%}td,th{padding:5px 10px;border-bottom:1px solid #d4dedb;text-align:left}small,code{color:#446058}";
fs.writeFileSync(
  file,
  '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>业务验收输入</title><style>' +
    css +
    "</style><main>" +
    html +
    "</main></html>",
);
console.log(file);
