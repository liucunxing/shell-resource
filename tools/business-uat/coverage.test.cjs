const assert = require("node:assert/strict");
const test = require("node:test");
const { fillMissingCoverage } = require("./coverage.cjs");

const projects = ["A", "B"].map((code) => ({ code, name: code, department: "MKT", sector: "P" }));
const scope = { department: "MKT", sector: "P" };
const roster = [
  { role: "owner", email: "o", enabled: true, projects, scopes: [scope] },
  ...["l1", "l2"].map((email) => ({
    role: "lead",
    email,
    enabled: true,
    projects: [],
    scopes: [scope],
  })),
  { role: "management", email: "m", enabled: true, projects: [], scopes: [] },
];
const suite = {
  cases: [
    { id: "test-projects", action: "owner-allocation", expected: "all projects" },
    { id: "test-handoff", action: "management-withdrawn", expected: "each withdrawal cycle" },
  ],
};
const pass = (caseId, user, scope) => ({ caseId, user, scope, status: "passed" });

test("one completed project cannot cover two, and two leads require two manager observations", () => {
  const run = {
    roster,
    results: [pass("test-projects", "o", "A A"), pass("test-handoff", "m", "P / MKT")],
  };
  fillMissingCoverage(run, suite);
  assert.deepEqual(
    run.results.filter((r) => r.status === "blocked").map((r) => [r.caseId, r.user, r.scope]),
    [
      ["test-projects", "o", "B B"],
      ["test-handoff", "m", "P / MKT"],
    ],
  );
  fillMissingCoverage(run, suite);
  assert.equal(run.results.length, 4);
});

test("complete evidence remains unchanged", () => {
  const run = {
    roster,
    results: [
      pass("test-projects", "o", "A A"),
      pass("test-projects", "o", "B B"),
      pass("test-handoff", "m", "P / MKT"),
      pass("test-handoff", "m", "P / MKT"),
    ],
  };
  fillMissingCoverage(run, suite);
  assert.ok(run.results.every((r) => r.status === "passed"));
});
