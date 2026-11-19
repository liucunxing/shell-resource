"use strict";

const { createHash } = require("node:crypto");

// Independent of browser results: derive the expected handoffs using the input population.
// A second lead in one scope repeats a withdrawal cycle, even when it yields identical
// manager and owner labels. Consume each evidence row at most once.
function fillMissingCoverage(run, inputs) {
  if (!run.roster?.length) return;
  const cases = new Map(inputs.cases.map((item) => [item.action, item]));
  const available = new Map();
  const key = (id, email, scope) => JSON.stringify([id, email || "", scope]);
  for (const row of run.results) {
    const k = key(row.caseId, row.user, row.scope);
    available.set(k, (available.get(k) || 0) + 1);
  }

  function expect(action, person, scope) {
    const item = cases.get(action);
    if (!item) return; // This action was not selected by the suite.
    const email = person?.email || "";
    const k = key(item.id, email, scope);
    const count = available.get(k) || 0;
    if (count) {
      available.set(k, count - 1);
      return;
    }
    run.results.push({
      caseId: item.id,
      user: email,
      scope,
      status: "blocked",
      expected: item.expected,
      actual: "按本轮人员、项目及负责范围应执行此项，但缺少对应操作结果。",
    });
  }

  const groups = new Map();
  function group(item) {
    const scope = [item.sector, item.department]
      .map((v) => String(v).trim().toUpperCase())
      .join(" / ");
    if (!groups.has(scope)) groups.set(scope, { scope, projects: [], leads: [] });
    return groups.get(scope);
  }

  function sample(items, count, salt) {
    // Case-file contract: within each population, order by sha256(seed + "/" + project code).
    const score = (p) =>
      createHash("sha256")
        .update(salt + "/" + p.code)
        .digest("hex");
    return items
      .slice()
      .sort((left, right) => score(left).localeCompare(score(right)))
      .slice(0, count);
  }
  const projectLabel = (p) => p.code + " " + p.name;
  const managers = run.roster.filter((p) => p.enabled && p.role === "management");
  for (const person of run.roster) {
    expect("identity-scope", person, "个人工作台");
    if (person.enabled && person.role === "admin") expect("admin-scope", person, "管理后台");
    for (const project of person.projects) {
      group(project).projects.push({ ...project, person });
      expect("owner-allocation", person, projectLabel(project));
      expect("owner-lock", person, projectLabel(project));
    }
    if (person.projects.length) {
      const [p] = sample(person.projects, 1, (run.seed ?? 1) + "/resubmit");
      expect("owner-resubmit", person, projectLabel(p));
    }
    if (person.role === "lead" && person.enabled) {
      for (const scope of person.scopes) group(scope).leads.push(person);
    }
  }
  const managerTargets = managers.length ? managers : [null];
  for (const person of managerTargets) expect("management-confirmed", person, "全部");
  const count = cases.get("owner-backtrack")?.parameters?.samplePerScope ?? 1;
  for (const area of groups.values()) {
    const leads = area.leads.length ? area.leads : [null];
    expect("department-confirm", leads[0], area.scope);
    for (const p of sample(area.projects, count, run.seed ?? 1)) {
      expect("owner-backtrack", p.person, projectLabel(p));
      expect("owner-submit-feedback", p.person, projectLabel(p));
      expect("owner-submit-feedback", p.person, projectLabel(p));
      expect("dealer-export", p.person, projectLabel(p));
    }
    for (const lead of leads) {
      expect("department-incomplete", lead, area.scope);
      expect("department-withdraw", lead, area.scope);
      expect("department-reconfirm", lead, area.scope);
      for (const person of managerTargets) {
        expect("management-withdrawn", person, area.scope);
        expect("management-restored", person, area.scope);
      }
      for (const p of area.projects) expect("owner-reopen", p.person, projectLabel(p));
    }
  }
}

module.exports = { fillMissingCoverage };
