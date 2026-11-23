const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");

const root = path.resolve(__dirname, "../..");
function git(...args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  }).trimEnd();
}

function identifyRelease(revision) {
  const head = git("rev-parse", "HEAD");
  if (revision && !/^[a-f0-9]{7,40}$/i.test(revision))
    throw new Error("部署提交须为 7 到 40 位 Git SHA");
  const target = revision ? git("rev-parse", "--verify", revision + "^{commit}") : head;
  const dirty = git("status", "--porcelain", "--untracked-files=all", "--", "frontend", "backend");
  if (dirty)
    throw new Error("应用工作区含未提交内容，无法将结果归入指定版本。请使用对应提交的干净检出。");
  if (git("diff", "--name-only", target, head, "--", "frontend", "backend", "Dockerfile")) {
    throw new Error("当前检出的应用与部署提交不同。请在包含该版本应用源码及验收工具的检出中运行。");
  }
  return { head, target, provided: Boolean(revision) };
}

// Build only from tracked application sources. The project's Vite plugin also writes
// dist/prototypes, so build inside the disposable copy, never in the product tree.
function buildFrontend(temp) {
  const app = path.join(temp, "frontend");
  const files = git("ls-files", "-z", "--", "frontend").split("\0").filter(Boolean);
  for (const file of files) {
    const target = path.join(temp, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, file), target);
  }
  const deps = path.join(root, "frontend/node_modules");
  if (!fs.existsSync(path.join(deps, "vite/bin/vite.js")))
    throw new Error("请先安装 frontend 的锁定依赖（npm ci --prefix frontend）。");
  // Vite puts its bundled config in node_modules/.vite-temp. Keep this cache in
  // the copy while sharing only installed packages.
  const isolatedDeps = path.join(app, "node_modules");
  fs.mkdirSync(isolatedDeps);
  for (const entry of fs.readdirSync(deps, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || !entry.isDirectory()) continue;
    fs.symlinkSync(
      path.join(deps, entry.name),
      path.join(isolatedDeps, entry.name),
      process.platform === "win32" ? "junction" : "dir",
    );
  }
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("VITE_")) delete env[key];
  Object.assign(env, {
    VITE_API_BASE_URL: "/api/v1/workbench",
    VITE_PLANNING_YEAR: "2027",
    VITE_LOGIN_EMAIL_EDITABLE: "false",
  });
  execFileSync(process.execPath, [path.join(deps, "vite/bin/vite.js"), "build"], {
    cwd: app,
    env,
    stdio: ["ignore", "ignore", "inherit"],
    timeout: 180_000,
  });
  return path.join(app, "dist");
}

// Optional live evidence. Only fetch the public document, its referenced entry
// script and the health endpoint. Never forward credentials, redirects or a browser session.
async function inspectDeployment(rawUrl, dist) {
  const site = new URL(rawUrl);
  if (
    site.protocol !== "https:" ||
    site.pathname !== "/" ||
    site.search ||
    site.hash ||
    site.username ||
    site.password
  ) {
    throw new Error("--deployment-url 须为无凭据、无路径的 HTTPS 站点根地址");
  }
  async function read(relative) {
    const response = await fetch(new URL(relative, site.origin), {
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(relative + " HTTP " + response.status);
    return response;
  }
  const health = await (await read("/health")).json();
  if (health.data?.status !== "ok") throw new Error("部署站点健康响应缺少预期的应用状态");
  const html = await (await read("/")).text();
  const match = html.match(/<script\b[^>]*\bsrc=["'](\/assets\/[a-zA-Z0-9_.-]+\.js)["']/);
  if (!match) throw new Error("部署首页未提供可核对的应用入口脚本");
  const entry = match[1];
  const localHtml = fs.readFileSync(path.join(dist, "index.html"), "utf8");
  if (!localHtml.includes('"' + entry + '"'))
    throw new Error("部署首页与隔离构建引用不同的前端资源");
  const digest = (content) => createHash("sha256").update(content).digest("hex");
  const remote = Buffer.from(await (await read(entry)).arrayBuffer());
  if (digest(remote) !== digest(fs.readFileSync(path.join(dist, entry.slice(1))))) {
    throw new Error("部署入口脚本与隔离构建的内容不同");
  }
  return "健康端点已响应，部署首页及入口脚本与本轮构建匹配";
}

module.exports = { root, identifyRelease, buildFrontend, inspectDeployment };
