"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { verifyDisabledUser } = require("./disabled-user.cjs");
const {
  Mismatch,
  Blocked,
  verify,
  need,
  btn,
  nav,
  scopeKey,
  newSession,
  openProject,
  goStep,
  allocate,
  inspectSubmitFeedback,
  backtrack,
  revise,
} = require("./browser-steps.cjs");
const {
  identityScope,
  departmentPage,
  departmentIncomplete,
  departmentTransition,
  managementPage,
} = require("./review-steps.cjs");

function groupsFor(roster) {
  const groups = new Map();
  function group(row) {
    const key = scopeKey(row);
    if (!groups.has(key))
      groups.set(key, {
        key,
        sector: row.sector,
        department: row.department,
        items: [],
        leads: [],
      });
    return groups.get(key);
  }
  for (const person of roster) {
    for (const p of person.projects) group(p).items.push({ ...p, person });
    if (person.role === "lead" && person.enabled)
      for (const scope of person.scopes) group(scope).leads.push(person);
  }
  return [...groups.values()];
}
function sample(rows, count, seed) {
  const score = (row) =>
    crypto
      .createHash("sha256")
      .update(String(seed) + "/" + row.code)
      .digest("hex");
  return rows
    .slice()
    .sort((a, b) => score(a).localeCompare(score(b)))
    .slice(0, count);
}
function conciseError(error) {
  const message = String(error.message || error)
    .split("\n")
    .filter(Boolean);
  return error instanceof Mismatch || error instanceof Blocked
    ? message[0]
    : "执行未取得完整证据。" +
        message
          .filter((line) => !line.startsWith("Call log"))
          .slice(0, 3)
          .join(" ")
          .replace(/\x1b\[[\d;]*m/g, "")
          .slice(0, 420);
}

async function runJourneys({
  browser,
  baseURL,
  roster,
  inputs,
  outputDir,
  onResult,
  sandbox,
  seed = 1,
}) {
  const origin = new URL(baseURL);
  if (
    origin.protocol !== "http:" ||
    origin.hostname !== "127.0.0.1" ||
    origin.origin !== sandbox.baseUrl ||
    !sandbox.runId
  ) {
    throw Error("此工具只接受当前隔离进程公布的回环地址。");
  }
  const result = [];
  const cases = new Map(inputs.cases.map((c) => [c.action, c]));
  const groups = groupsFor(roster),
    projects = groups.flatMap((g) => g.items);
  const session = new Map(),
    ledger = new Map(),
    confirmed = new Set(),
    dependencies = new Map();
  const byRole = (role) => roster.filter((user) => user.enabled && user.role === role);
  const managers = byRole("management"),
    evidenceKinds = new Set();
  let serial = 0;
  const evidenceDir = path.join(outputDir, "evidence");
  await fs.mkdir(evidenceDir, { recursive: true });
  async function shot(page, action) {
    const relative = "evidence/" + String(++serial).padStart(3, "0") + "-" + action + ".png";
    await page.screenshot({
      path: path.join(outputDir, relative),
      timeout: 5000,
      animations: "disabled",
    });
    return relative;
  }
  function pageFor(user) {
    const s = session.get(user?.email);
    need(s, "此用户的测试会话未建立。");
    return s.page;
  }
  async function run(action, user, scope, work, successShot = false) {
    const test = cases.get(action);
    const row = {
      caseId: test.id,
      user: user?.email || "",
      scope,
      expected: test.expected,
      status: "blocked",
      actual: "",
    };
    const key = action + "/" + scope + "/" + row.user;
    let page;
    try {
      if (user) need(test.actors.includes(user.role), "用例不适用于当前角色。");
      page = session.get(user?.email)?.page;
      row.actual = await work();
      row.status = "passed";
      if (successShot && !evidenceKinds.has(action) && page) {
        row.evidence = await shot(page, action);
        evidenceKinds.add(action);
      }
    } catch (e) {
      row.status = e instanceof Mismatch ? "failed" : "blocked";
      row.actual = conciseError(e);
      page ??= session.get(user?.email)?.page;
      if (page && !(e instanceof Blocked)) {
        try {
          row.evidence = await shot(page, action);
        } catch {
          /* retain the original observation */
        }
      }
    }
    dependencies.set(key, row.status === "passed");
    result.push(row);
    if (onResult) await onResult(row);
    return row;
  }
  function needProject(p) {
    need(ledger.has(p.id), "此前未取得此项目已配平并提交的证据。");
  }
  function leadFor(g) {
    return g.leads[0];
  }
  async function forManagers(action, g, work) {
    const scope = g?.key || "全部";
    if (!managers.length)
      return run(action, null, scope, () => {
        throw new Blocked("本轮名单没有管理层账号。");
      });
    for (const u of managers) await run(action, u, scope, work.bind(null, u), true);
  }
  const handlers = {
    async "identity-scope"() {
      for (const u of roster)
        await run("identity-scope", u, "个人工作台", async () => {
          if (!u.enabled) return verifyDisabledUser(browser, sandbox, u);
          const s = await newSession(browser, baseURL, u);
          session.set(u.email, s);
          return identityScope(s.page, u, sandbox.versionId);
        });
    },
    async "admin-scope"() {
      for (const u of byRole("admin"))
        await run("admin-scope", u, "管理后台", async () => {
          const p = pageFor(u);
          await nav(p, "用户与权限").click();
          await p
            .getByRole("heading", { name: /用户与权限|人员与权限/ })
            .first()
            .waitFor();
          await nav(p, "版本与发布").click();
          await p.getByRole("table").first().waitFor();
          return "已查看用户与权限、版本与发布页面。";
        });
    },
    async "department-incomplete"() {
      for (const g of groups)
        for (const u of g.leads.length ? g.leads : [null])
          await run(
            "department-incomplete",
            u,
            g.key,
            () => {
              need(u, "本轮授权名单未提供该范围的部门负责人。");
              return departmentIncomplete(pageFor(u), g, sandbox.versionId);
            },
            true,
          );
    },
    async "owner-allocation"() {
      // The sampled projects finish this same case inside their first, still-unsubmitted round trip.
      const sampled = new Set(backtrackSample().map((p) => p.id));
      for (const p of projects.filter((p) => !sampled.has(p.id))) await firstSubmission(p);
    },
    async "owner-backtrack"() {
      for (const p of backtrackSample()) {
        let midpointEvidence;
        let attempted = false;
        await firstSubmission(p, async (initial) => {
          let updated;
          attempted = true;
          const row = await run("owner-backtrack", p.person, p.code + " " + p.name, async () => {
            const page = pageFor(p.person);
            updated = await backtrack(page, p, initial, sandbox.versionId, async () => {
              if (!evidenceKinds.has("midpoint")) {
                midpointEvidence = await shot(page, "owner-backtrack");
                evidenceKinds.add("midpoint");
              }
              if (cases.has("owner-submit-feedback")) {
                // A UX defect must not prevent the owner from completing the business journey.
                await run(
                  "owner-submit-feedback",
                  p.person,
                  p.code + " " + p.name,
                  () => inspectSubmitFeedback(page),
                  true,
                );
              }
            });
            return "首次提交前保存半额草稿。折返增改删预留、替换零元经销商，刷新后金额和名单相符，配平后首次提交成功。";
          });
          if (midpointEvidence && !row.evidence) row.evidence = midpointEvidence;
          need(row.status === "passed", "首次提交依赖的中途折返场景未通过。");
          return updated;
        });
        if (!attempted)
          await run("owner-backtrack", p.person, p.code + " " + p.name, () => {
            throw new Blocked("项目未完成初始预留和选商，未进入折返步骤。");
          });
      }
    },
    async "owner-submit-feedback"() {
      for (const p of backtrackSample()) {
        const scope = p.code + " " + p.name;
        if (!dependencies.has("owner-submit-feedback/" + scope + "/" + p.person.email))
          await run("owner-submit-feedback", p.person, scope, () => {
            throw new Blocked("此前未到达已保存半额草稿的现场。");
          });
      }
    },
    async "dealer-export"() {
      const { checkDealerExport } = require("./dealer-export.cjs");
      for (const p of backtrackSample())
        await run("dealer-export", p.person, p.code + " " + p.name, async () => {
          needProject(p);
          return checkDealerExport(pageFor(p.person), p, ledger.get(p.id), sandbox.versionId);
        });
    },
    async "owner-resubmit"() {
      for (const u of roster.filter((x) => x.projects.length)) {
        const p = sample(
          projects.filter((p) => p.person === u),
          1,
          String(seed) + "/resubmit",
        )[0];
        await run("owner-resubmit", u, p.code + " " + p.name, async () => {
          needProject(p);
          ledger.set(p.id, await revise(pageFor(u), p, ledger.get(p.id), sandbox.versionId));
          return "修改已提交方案，保存后项目退出齐交，按新金额配平并重新提交成功。";
        });
      }
    },
    async "department-confirm"() {
      for (const g of groups) {
        const u = leadFor(g);
        await run("department-confirm", u, g.key, async () => {
          need(u, "本轮授权名单未提供该范围的部门负责人。");
          need(g.items.length, "此范围没有启用项目。");
          g.items.forEach(needProject);
          const actual = await departmentTransition(
            pageFor(u),
            g,
            sandbox.versionId,
            "confirm",
            ledger,
          );
          confirmed.add(g.key);
          return actual;
        });
      }
    },
    async "owner-lock"() {
      for (const p of projects)
        await run("owner-lock", p.person, p.code + " " + p.name, async () => {
          need(confirmed.has(scopeKey(p)), "此部门未完成确认。");
          const page = pageFor(p.person);
          await page.reload({ waitUntil: "domcontentloaded" });
          await openProject(page, p, sandbox.versionId);
          await goStep(page, 3);
          verify(
            (await page.getByText(/部门已提交；版本开放时/).count()) > 0,
            "部门确认后未显示锁定原因。",
          );
          verify(
            (await page.locator('input[aria-label$=" 分配金额"]').count()) === 0 &&
              (await btn(page, /^提交到 /).count()) === 0 &&
              (await btn(page, "保存草稿").count()) === 0,
            "锁定状态下仍有可编辑的分配或保存/提交入口。",
          );
          return "方案仍可查看，页面说明部门确认锁定原因，分配金额只读。";
        });
    },
    async "management-confirmed"() {
      await forManagers("management-confirmed", null, async (u) => {
        need(confirmed.size, "尚无已确认部门。");
        return managementPage(pageFor(u), projects, ledger, confirmed, sandbox.versionId);
      });
    },
    async "department-withdraw"(g, u) {
      await run("department-withdraw", u, g.key, async () => {
        need(u && confirmed.has(g.key), "此部门尚未完成首次确认。");
        const msg = await departmentTransition(
          pageFor(u),
          g,
          sandbox.versionId,
          "withdraw",
          ledger,
        );
        confirmed.delete(g.key);
        return msg;
      });
    },
    async "management-withdrawn"(g, u) {
      await forManagers("management-withdrawn", g, async (manager) => {
        need(
          dependencies.get("department-withdraw/" + g.key + "/" + (u?.email || "")),
          "本次撤回未完成。",
        );
        return managementPage(pageFor(manager), projects, ledger, confirmed, sandbox.versionId);
      });
    },
    async "owner-reopen"(g, u) {
      const selected = new Map();
      for (const person of new Set(g.items.map((p) => p.person))) {
        const p = sample(
          g.items.filter((p) => p.person === person),
          1,
          String(seed) + "/reopen",
        )[0];
        selected.set(person.email, p.id);
      }
      for (const p of g.items)
        await run("owner-reopen", p.person, p.code + " " + p.name, async () => {
          need(
            dependencies.get("department-withdraw/" + g.key + "/" + (u?.email || "")),
            "本次撤回未完成。",
          );
          const page = pageFor(p.person);
          await page.reload({ waitUntil: "domcontentloaded" });
          if (selected.get(p.person.email) !== p.id) {
            await openProject(page, p, sandbox.versionId);
            await goStep(page, 3);
            verify(await btn(page, "保存草稿").isEnabled(), "未更改项目在撤回后仍锁定。");
            return "项目已解锁，保留原提交，随后参与部门齐交。";
          }
          const checkDraft = async () => {
            const leadPage = pageFor(u);
            if (page === leadPage) return; // One person can own and approve. Its two views cannot share a page during the edit.
            const rows = await departmentPage(leadPage, g, sandbox.versionId);
            const row = rows.filter({
              has: leadPage.getByText(p.name, { exact: true }),
            });
            verify(
              (await row.locator("td").nth(2).innerText()).trim() !== "已提交" &&
                (await btn(leadPage, "提交部门方案至管理层").isDisabled()),
              "项目改动后尚未重提，部门页面仍显示齐交。",
            );
          };
          ledger.set(p.id, await revise(page, p, ledger.get(p.id), sandbox.versionId, checkDraft));
          return "撤回后解锁，改投并保存草稿后重新配平提交。";
        });
    },
    async "department-reconfirm"(g, u) {
      await run("department-reconfirm", u, g.key, async () => {
        need(
          dependencies.get("department-withdraw/" + g.key + "/" + (u?.email || "")),
          "本次撤回未完成。",
        );
        for (const p of g.items)
          need(
            dependencies.get("owner-reopen/" + p.code + " " + p.name + "/" + p.person.email),
            "本部门 Owner 尚未全部完成撤回后的验收。",
          );
        const actual = await departmentTransition(
          pageFor(u),
          g,
          sandbox.versionId,
          "confirm",
          ledger,
        );
        confirmed.add(g.key);
        return actual;
      });
    },
    async "management-restored"(g, u) {
      await forManagers("management-restored", g, async (manager) => {
        need(
          dependencies.get("department-reconfirm/" + g.key + "/" + (u?.email || "")),
          "本次部门重提未完成。",
        );
        return managementPage(pageFor(manager), projects, ledger, confirmed, sandbox.versionId);
      });
    },
  };
  function backtrackSample() {
    if (!cases.has("owner-backtrack")) return [];
    const count = cases.get("owner-backtrack").parameters?.samplePerScope ?? 1;
    if (!Number.isSafeInteger(count) || count < 1) throw Error("samplePerScope 必须为正整数。");
    return groups.flatMap((g) => sample(g.items, count, seed));
  }
  function firstSubmission(p, onHalfAllocated) {
    return run("owner-allocation", p.person, p.code + " " + p.name, async () => {
      const state = await allocate(pageFor(p.person), p, sandbox.versionId, onHalfAllocated);
      ledger.set(p.id, state);
      return (
        "已提交，预算 " +
        p.budgetCny +
        " 元 = 分配 " +
        state.invest +
        " 元 + 预留 " +
        state.reserve +
        " 元。第二家经销商保留零元。"
      );
    });
  }
  try {
    const byId = new Map(inputs.cases.map((c) => [c.id, c]));
    for (const journey of inputs.journeys) {
      const actions = journey.steps.map((id) => byId.get(id)?.action);
      for (const action of actions)
        if (!handlers[action]) throw Error("未实现的验收动作 " + action);
      if (actions.includes("department-withdraw")) {
        for (const g of groups)
          for (const u of g.leads.length ? g.leads : [null])
            for (const action of actions) await handlers[action](g, u);
      } else {
        for (const action of actions) await handlers[action]();
      }
    }
    for (const test of inputs.cases)
      if (!result.some((row) => row.caseId === test.id)) {
        await run(test.action, null, "适用范围", () => {
          throw new Blocked("本轮名单没有可执行该用例的身份或启用项目。");
        });
      }
  } finally {
    await Promise.all([...session.values()].map((s) => s.ctx.close().catch(() => {})));
  }
  return result;
}
module.exports = { runJourneys };
