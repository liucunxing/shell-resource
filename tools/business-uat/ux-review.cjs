const fs = require("node:fs");
const path = require("node:path");
const { root } = require("./release.cjs");

function applyReview(dir) {
  const reports = fs.realpathSync(path.join(root, "outputs/business-uat"));
  const run = fs.realpathSync(dir);
  if (path.dirname(run) !== reports) throw new Error("仅接受本工具生成的一轮输出目录");
  const safeFile = (name) => {
    const file = fs.realpathSync(path.resolve(run, name));
    if (!file.startsWith(run + path.sep) || !fs.statSync(file).isFile())
      throw new Error("文件须位于本轮输出目录中");
    return file;
  };
  const json = (name) => JSON.parse(fs.readFileSync(safeFile(name), "utf8").replace(/^\uFEFF/, ""));
  const result = json("results.json");
  const review = json("ux-review.json");
  if (
    result.id !== path.basename(run) ||
    review.runId !== result.id ||
    !review.observations?.length
  )
    throw new Error("复核记录须绑定当前 runId 并包含观察记录");
  const esc = (x) =>
    String(x).replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  const cards = [];
  const levels = ["影响使用", "可完成", "待核实"];
  for (const item of review.observations) {
    if (
      !levels.includes(item.status) ||
      ![item.role, item.task, item.observed, item.impact].every(
        (x) => typeof x === "string" && x.trim(),
      )
    )
      throw new Error("每条观察需要状态、角色、任务、观察与影响");
    let link = "";
    if (item.evidence) {
      const relative = path.relative(run, safeFile(item.evidence));
      if (!/\.(png|jpe?g|webp)$/i.test(relative)) throw new Error("体验证据须指向本轮截图");
      link =
        ' <a href="' +
        relative.split(path.sep).map(encodeURIComponent).join("/") +
        '">查看现场</a>';
    } else if (item.status !== "待核实") throw new Error("已核实的体验观察须附本轮截图");
    cards.push(
      "<article><b>" +
        esc(item.status) +
        " · " +
        esc(item.task) +
        "</b><p>" +
        esc(item.role) +
        "　" +
        esc(item.observed) +
        "</p><p>" +
        esc(item.impact) +
        link +
        "</p></article>",
    );
  }
  const issues = review.observations.filter((o) => o.status === "影响使用").length;
  const pending = review.observations.filter((o) => o.status === "待核实").length;
  const title =
    "体验观察 " + cards.length + " 项，影响使用 " + issues + " 项，待核实 " + pending + " 项";
  const section =
    "<!-- ux-start --><section><details" +
    (issues ? " open" : "") +
    "><summary>" +
    title +
    "</summary>" +
    cards.join("") +
    "</details></section><!-- ux-end -->";
  const index = safeFile("index.html");
  const html = fs.readFileSync(index, "utf8");
  const region = /<!-- ux-start -->[\s\S]*?<!-- ux-end -->/;
  if (!region.test(html)) throw new Error("首页不支持本版体验复核");
  const conclusion = issues
    ? "建议暂缓验收"
    : pending && !result.exitCode
      ? "体验证据待补充"
      : result.verdict;
  const output = html
    .replace(region, () => section)
    .replace(/<h1>[^<]*<\/h1>/, "<h1>" + esc(conclusion) + "</h1>");
  fs.writeFileSync(index, output);
  result.businessReview = { conclusion, issues, pending, observations: review.observations };
  fs.writeFileSync(safeFile("results.json"), JSON.stringify(result, null, 2));
  console.log(title + " · " + index);
}

try {
  applyReview(process.argv[2] || "");
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
