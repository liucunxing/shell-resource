const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");
const { spawn } = require("node:child_process");
const { parseArgs } = require("node:util");
const { setTimeout: delay } = require("node:timers/promises");
const { root, identifyRelease, buildFrontend, inspectDeployment } = require("./release.cjs");
const { writeReport } = require("./report.cjs");

const flags = Object.fromEntries(
  ["revision", "deployment-url", "inputs", "fixture", "roster", "python", "seed", "channel"].map(
    (k) => [k, { type: "string" }],
  ),
);
const help =
  "node tools/business-uat/cli.cjs [--revision 部署提交SHA] [--deployment-url https://站点] [--seed 正整数] [--inputs 输入目录] [--roster 脱敏用户.json] [--fixture 完整合成快照.json] [--python 解释器] [--channel chrome|msedge]";
const digest = (s) => createHash("sha256").update(s).digest("hex");
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));

function validate(inputs) {
  if (inputs.schemaVersion !== 1 || !inputs.cases?.length || !inputs.journeys?.length)
    throw new Error("验收输入缺少有效的旅程和案例");
  const ids = inputs.cases.map((c) => c.id);
  const actions = inputs.cases.map((c) => c.action);
  const steps = inputs.journeys.flatMap((j) => j.steps);
  if (
    new Set(ids).size !== ids.length ||
    new Set(actions).size !== actions.length ||
    steps.length !== ids.length ||
    new Set(steps).size !== ids.length ||
    steps.some((id) => !ids.includes(id)) ||
    inputs.cases.some((c) => !c.action || !c.expected || !c.title)
  ) {
    throw new Error("每个案例须有唯一 ID 和唯一的执行动作，并在旅程中出现一次，包含标题与预期");
  }
}

function startSandbox(args) {
  const child = spawn(args[0], args.slice(1), {
    cwd: root,
    stdio: ["pipe", "ignore", "pipe"],
    windowsHide: true,
  });
  let tail = "";
  child.stderr.on("data", (s) => {
    tail = (tail + s.toString()).slice(-2200);
  });
  let end;
  const finished = new Promise((resolve) => {
    child.once("error", (e) => {
      end = e.message;
      resolve();
    });
    child.once("close", (code) => {
      end = "exit " + code;
      resolve();
    });
  });
  return {
    async ready(file) {
      const endTime = Date.now() + 120_000;
      while (Date.now() < endTime) {
        if (end) throw new Error("隔离应用启动失败 " + end + " " + tail);
        if (fs.existsSync(file)) return json(file);
        await delay(150);
      }
      throw new Error("隔离应用启动超时 " + tail);
    },
    async close() {
      child.stdin.end();
      const timer = setTimeout(() => child.kill(), 10000);
      try {
        await finished;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

async function launchBrowser(channel) {
  const { chromium } = require("playwright");
  let last;
  for (const name of channel ? [channel] : [undefined, "chrome", "msedge"]) {
    try {
      return await chromium.launch({
        headless: true,
        channel: name,
        args: ["--disable-background-networking"],
      });
    } catch (error) {
      last = error;
    }
  }
  throw new Error(
    "无法启动 Chromium。请安装工具包的 Playwright Chromium 或 Chrome/Edge。" +
      last.message.slice(0, 220),
  );
}

function restrictedBrowser(browser, origin) {
  return {
    async newContext(options) {
      const ctx = await browser.newContext({ ...options, serviceWorkers: "block" });
      await ctx.route("**/*", (route) =>
        new URL(route.request().url()).origin === origin
          ? route.continue()
          : route.abort("blockedbyclient"),
      );
      await ctx.routeWebSocket("**/*", (ws) => ws.close());
      return ctx;
    },
  };
}

async function main() {
  const { values: opt } = parseArgs({
    options: { ...flags, help: { type: "boolean", short: "h" } },
  });
  if (opt.help) {
    console.log(help);
    return;
  }
  if (opt.seed && !/^[1-9][0-9]{0,8}$/.test(opt.seed))
    throw new Error("--seed 需要 1 至 9 位正整数");
  const inputDir = path.resolve(opt.inputs || path.join(root, "uat-inputs/resource-studio"));
  const inputs = json(path.join(inputDir, "cases.json"));
  validate(inputs);
  const id = new Date().toISOString().replace(/[:.]/g, "-") + "-" + process.pid;
  const outputDir = path.join(root, "outputs/business-uat", id);
  fs.mkdirSync(outputDir, { recursive: true });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "business-uat-"));
  const run = { id, started: new Date().toISOString(), seed: Number(opt.seed || 1), results: [] };
  let sandbox, browser;
  console.log("业务验收报告 " + outputDir);
  try {
    run.release = identifyRelease(opt.revision);
    const dist = buildFrontend(temp);
    if (opt["deployment-url"]) {
      try {
        run.deployment = await inspectDeployment(opt["deployment-url"], dist);
      } catch (err) {
        run.deployment = "部署只读核对未完成";
        run.error = err.message;
      }
    }
    const python =
      opt.python ||
      path.join(
        root,
        process.platform === "win32"
          ? "backend/.venv/Scripts/python.exe"
          : "backend/.venv/bin/python",
      );
    const file = path.join(temp, "ready.json");
    const args = [
      python,
      "-B",
      path.join(__dirname, "sandbox.py"),
      "--frontend-dist",
      dist,
      "--ready-file",
      file,
    ];
    if (opt.fixture) args.push("--fixture", path.resolve(opt.fixture));
    const rosterFile = opt.roster || (!opt.fixture && path.join(inputDir, "roster.json"));
    if (rosterFile) args.push("--roster", path.resolve(rosterFile));
    sandbox = startSandbox(args);
    const ready = await sandbox.ready(file);
    if (
      !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(ready.baseUrl) ||
      !ready.runId ||
      ready.sourceCommit !== run.release.head
    )
      throw new Error("隔离应用来源核验失败");
    const response = await fetch(ready.baseUrl + "/health", {
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok || response.headers.get("x-uat-run-id") !== ready.runId)
      throw new Error("本轮隔离实例身份核验失败");
    run.roster = ready.users;
    run.rosterSource = opt.roster
      ? "指定脱敏测试名单"
      : opt.fixture
        ? "指定合成快照与测试名单"
        : "项目验收包内合成测试名单";
    run.inputs = {
      suiteSha256: digest(JSON.stringify(inputs)),
      fixtureSha256: ready.fixtureSha256,
      rosterSha256: ready.rosterSha256,
      frontendSha256: ready.frontendSha256,
      versionId: ready.versionId,
    };
    run.comparisonKey = digest(
      JSON.stringify([run.inputs.suiteSha256, ready.fixtureSha256, ready.rosterSha256, run.seed]),
    );
    console.log("隔离实例就绪 · " + ready.users.length + " 位测试用户");
    browser = await launchBrowser(opt.channel);
    run.browserVersion = browser.version();
    const { runJourneys } = require("./journeys.cjs");
    const received = [];
    run.results = received;
    const results = await runJourneys({
      browser: restrictedBrowser(browser, ready.baseUrl),
      baseURL: ready.baseUrl,
      roster: ready.users,
      inputs,
      sandbox: ready,
      seed: run.seed,
      outputDir,
      onResult(r) {
        received.push(r);
        console.log(
          [r.status, r.caseId, r.user, r.scope, r.status === "passed" ? "" : r.actual]
            .filter(Boolean)
            .join(" · "),
        );
      },
    });
    if (Array.isArray(results)) run.results = results;
  } catch (error) {
    run.error = [run.error, error.message].filter(Boolean).join("；");
  } finally {
    for (const cleanup of [
      () => browser?.close(),
      () => sandbox?.close(),
      () => fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3 }),
    ]) {
      try {
        await cleanup();
      } catch (error) {
        run.error = [run.error, "清理临时资源受阻 " + error.message].filter(Boolean).join("；");
      }
    }
  }
  for (const c of inputs.cases) {
    if (!run.results.some((r) => r.caseId === c.id)) {
      run.results.push({
        caseId: c.id,
        user: "",
        scope: "",
        status: "blocked",
        expected: c.expected,
        actual: run.error ? "执行受阻，未取得现场证据" : "本轮没有该动作的执行记录",
      });
    }
  }
  run.finished = new Date().toISOString();
  writeReport(outputDir, run, inputs);
  console.log(run.verdict + " · " + path.join(outputDir, "index.html"));
  if (run.error) console.error(run.error);
  process.exitCode = run.exitCode;
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 2;
});
