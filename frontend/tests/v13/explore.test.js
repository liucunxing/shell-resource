import { test as vitestTest } from "vitest";
import assert from "node:assert/strict";
import E from "../../src/workbench/domain/engine.js";
import X from "../../src/workbench/domain/explore.js";
import D from "../../src/workbench/domain/demo-data.json";

vitestTest(
  "V1.3 explore original regression contract",
  async () => {
    let checks = 0;
    const test = (label, f) => {
      f();
      checks++;
      console.log("PASS " + label);
    };
    const lead = { role: "lead", department: "MKT" },
      owner = { role: "owner", department: "MKT", ownerId: "MKT-1" },
      management = { role: "management" },
      admin = { role: "admin" };
    const working = E.createState(D, "working"),
      submitted = E.createState(D, "submitted");
    test("analytics rejects unauthorized roles and dimensions", () => {
      assert.throws(() => X.analytics(working, owner));
      assert.throws(() => X.analytics(working, admin));
      assert.throws(() => X.analytics(working, lead, "department"));
    });
    test("lead allocated denominator excludes reserve and budget", () => {
      let s = structuredClone(working);
      const i = s.initiatives.find((i) => i.department === "MKT");
      i.budget += 987;
      i.reserve = 987;
      const m = X.analytics(s, lead);
      assert.equal(
        m.total,
        E.totals(s.initiatives.filter((i) => i.department === "MKT")).allocated,
      );
      assert.ok(Math.abs(m.rows.reduce((n, r) => n + r.share, 0) - 1) < 1e-12);
    });
    test("management only sees latest published snapshots", () => {
      assert.equal(X.analytics(working, management).total, 0);
      const m = X.analytics(submitted, management);
      assert.equal(m.total, 6402000);
      assert.equal(m.coverage.published, 3);
      assert.match(m.basisLabel, /最新发布版本/);
    });
    test("partial publishing labels coverage and excludes unpublished departments", () => {
      let s = structuredClone(submitted);
      s.initiatives
        .filter((item) => ["ICE", "CAPEX"].includes(item.department))
        .forEach((item) => delete s.publications[item.id]);
      const m = X.analytics(s, management, "department");
      assert.equal(m.coverage.published, 1);
      assert.equal(m.rows.length, 1);
      assert.equal(m.rows[0].id, "MKT");
      assert.match(m.basisLabel, /1\/3/);
    });
    test("same name initiatives never merge", () => {
      const m = X.analytics(submitted, management, "initiative");
      assert.equal(m.rows.length, D.initiatives.length);
      assert.equal(new Set(m.rows.map((r) => r.id)).size, D.initiatives.length);
    });
    test("management latest published snapshot is immune to working draft mutations", () => {
      let s = structuredClone(submitted);
      s.initiatives[0].rows[0].amount = 99999999;
      s.initiatives.find((i) => i.department === "MKT").rows[0].amount =
        99999999;
      assert.equal(X.analytics(s, management).total, 6402000);
    });
    test("owner and lead raw data stays on their live working items", () => {
      let s = structuredClone(submitted);
      const mine = s.initiatives.find((i) => i.ownerId === "MKT-1");
      mine.rows[0].amount = 123456;
      const ownerRows = X.rawData(s, owner, D, "allocations").rows;
      assert.equal(
        ownerRows.find(
          (r) =>
            r.initiativeId === mine.id && r.dealerId === mine.rows[0].dealerId,
        ).amount,
        123456,
      );
      const leadRows = X.rawData(s, lead, D, "allocations").rows;
      assert.equal(
        leadRows.find(
          (r) =>
            r.initiativeId === mine.id && r.dealerId === mine.rows[0].dealerId,
        ).amount,
        123456,
      );
    });
    test("group detail explicitly sanitized and scoped", () => {
      const m = X.analytics(working, lead);
      const d = X.groupDetail(working, lead, "sector", m.rows[0].id);
      assert.ok(d.every((i) => i.department === "MKT"));
      assert.ok(d.every((i) => !("rows" in i) && !("sourceRow" in i)));
      assert.throws(() => X.groupDetail(working, lead, "sector", "no-such-id"));
    });
    test("owner allocation rows restricted before filtering", () => {
      const m = X.rawData(working, owner, D);
      assert.ok(m.rows.length > 0);
      assert.ok(m.rows.every((r) => r.ownerId === "MKT-1"));
      assert.equal(X.filterRows(m, "MKT-2").length, 0);
    });
    test("admin has configuration rows without unprovided spend details", () => {
      const m = X.rawData(working, admin, D);
      assert.equal(m.tab, "budgets");
      assert.equal(m.rows.length, 75);
      assert.ok(
        m.rows.every((r) => !("allocated" in r) && !("otherBudgetTotal" in r)),
      );
      assert.throws(() => X.rawData(working, admin, D, "allocations"));
      assert.throws(() => X.rawData(working, admin, D, "other-budgets"));
    });
    test("management raw uses latest published snapshots only", () => {
      assert.equal(X.rawData(working, management, D).rows.length, 0);
      assert.equal(X.rawData(submitted, management, D).rows.length, 600);
    });
    for (const department of ["MKT", "ICE", "CAPEX"])
      test(
        department +
          " history resource columns remain scoped with shared Yield",
        () => {
          const m = X.rawData(
            working,
            { role: "lead", department },
            D,
            "history",
          );
          assert.equal(m.rows.length, 60);
          const allowed =
            department === "MKT"
              ? ["MRD", "SP&A"]
              : department === "ICE"
                ? ["ICE Rebate"]
                : ["Capex"];
          for (const row of m.rows) {
            assert.ok(!("resource2025" in row));
            assert.ok("yield2025" in row);
            assert.ok(!("resourcePerLiter2025" in row));
            assert.deepEqual(
              Object.keys(row)
                .filter((k) => k.startsWith("resource_"))
                .sort(),
              allowed.map((r) => "resource_" + r).sort(),
            );
            assert.ok("vol2025" in row && "c32025" in row);
          }
        },
      );
    test("overall same-year yield authorized and labeled", () => {
      const m = X.rawData(working, management, D, "history");
      assert.ok(m.rows.every((r) => "yield2025" in r));
      assert.ok(
        m.columns
          .find((c) => c.key === "yield2025")
          .label.includes("2025 C3 / 2025"),
      );
    });
    test("CSV BOM escapes Excel formulas and multiline content", () => {
      const m = {
        columns: [{ key: "v", label: "Value" }],
        rows: [{ v: "=1+1" }, { v: " \t@evil" }, { v: '<test>,"\nhello' }],
      };
      const c = X.csv(m);
      assert.equal(c.charCodeAt(0), 0xfeff);
      assert.ok(c.includes('"\'=1+1"'));
      assert.ok(c.includes('"\' \t@evil"'));
      assert.ok(c.includes('""'));
    });
    test("HTML escaping and pagination", () => {
      const m = X.rawData(working, owner, D);
      m.rows[0].note = "<script>bad</script>";
      const html = X.renderRaw(m, { page: 1, pageSize: 15 });
      assert.ok(html.includes("&lt;script&gt;"));
      assert.ok(!html.includes("<script>"));
      assert.ok(html.includes('id="raw-search"'));
      assert.ok(html.includes('data-action="raw-export"'));
    });
    test("top10 clearly distinguishes all-data denominator", () => {
      const html = X.renderAnalytics(
        X.analytics(submitted, management, "initiative"),
      );
      assert.ok(html.includes("不一定合计 100%"));
      assert.ok(html.includes("全部排行"));
    });
    test("all roles receive recomputed same-year Yield despite stale cached value", () => {
      const d = structuredClone(D);
      d.dealers[0].history.c32025 = 900;
      d.dealers[0].history.resource2025 = 300;
      d.dealers[0].history.yield2025 = 999;
      for (const identity of [owner, lead, management, admin]) {
        const m = X.rawData(working, identity, d, "history");
        assert.equal(m.rows[0].yield2025, 3);
        assert.ok(m.columns.some((c) => c.key === "yield2025"));
        assert.equal(
          X.historyReference(working, identity, d, d.dealers[0].id).yield2025,
          3,
        );
      }
    });
    test("Yield missing or invalid denominator remains null", () => {
      for (const denominator of [0, undefined, null, Infinity, NaN, -1]) {
        const d = structuredClone(D);
        d.dealers[0].history.resource2025 = denominator;
        assert.equal(
          X.rawData(working, owner, d, "history").rows[0].yield2025,
          null,
        );
      }
      const d = structuredClone(D);
      delete d.dealers[0].history.c32025;
      assert.equal(
        X.rawData(working, owner, d, "history").rows[0].yield2025,
        null,
      );
      d.dealers[0].history.c32025 = 0;
      assert.equal(
        X.rawData(working, owner, d, "history").rows[0].yield2025,
        0,
      );
    });
    test("historyReference periods and resources respect role boundary", () => {
      for (const identity of [
        owner,
        lead,
        { role: "lead", department: "ICE" },
        { role: "lead", department: "CAPEX" },
        management,
        admin,
      ]) {
        const m = X.historyReference(working, identity, D, D.dealers[0].id);
        assert.deepEqual(
          m.periods.map((p) => p.comparable),
          [true, true, false],
        );
        assert.equal(m.periods[2].label, "2026 1–8月");
        const all = ["management", "admin"].includes(identity.role);
        assert.equal(m.allResources, all);
        const labels = all
          ? ["2025 MRD", "2025 SP&A", "2025 ICE Rebate", "2025 Capex"]
          : identity.department === "MKT"
            ? ["2025 MRD", "2025 SP&A"]
            : identity.department === "ICE"
              ? ["2025 ICE Rebate"]
              : ["2025 Capex"];
        assert.deepEqual(
          m.resources.map((r) => r.label),
          labels,
        );
        assert.ok(!("resource2025" in m));
      }
      assert.throws(
        () => X.historyReference(working, owner, D, "not-found"),
        /经销商不存在/,
      );
      assert.throws(() =>
        X.historyReference(working, { role: "invalid" }, D, D.dealers[0].id),
      );
    });
    test("owner raw history CSV exposes only authorized detail plus shared Yield", () => {
      const m = X.rawData(working, owner, D, "history");
      const keys = m.columns.map((c) => c.key);
      assert.ok(keys.includes("yield2025"));
      assert.ok(!keys.includes("resource2025"));
      assert.ok(!keys.includes("resourcePerLiter2025"));
      assert.ok(!keys.includes("resource_ICE Rebate"));
      assert.ok(!keys.includes("resource_Capex"));
      const csv = X.csv(m);
      assert.ok(csv.includes("2025 C3 / 2025 资源"));
      assert.ok(!csv.includes("2025 资源总额"));
    });
    test("other budget raw data preserves every row, reason, amount and note", () => {
      let s = structuredClone(working);
      const i = s.initiatives.find((i) => i.ownerId === "MKT-1");
      i.otherBudgets = [
        {
          id: "OB-1",
          reasonId: "new-dealer-reserve",
          amount: 1200,
          note: "新网点试点",
        },
        {
          id: "OB-2",
          reasonId: "unallocated-dealer",
          amount: 800,
          note: "缺少归属规则",
        },
      ];
      s.budgetReasons = [
        { id: "new-dealer-reserve", label: "新增经销商预留" },
        { id: "unallocated-dealer", label: "无法分配到经销商" },
        { id: "other", label: "其他支出" },
      ];
      const m = X.rawData(s, owner, D, "other-budgets");
      const rows = m.rows.filter((r) => r.initiativeId === i.id);
      assert.equal(rows.length, 2);
      assert.deepEqual(
        rows.map((r) => [
          r.otherBudgetReason,
          r.otherBudgetAmount,
          r.otherBudgetNote,
        ]),
        [
          ["新增经销商预留", 1200, "新网点试点"],
          ["无法分配到经销商", 800, "缺少归属规则"],
        ],
      );
      const csv = X.csv(m);
      assert.ok(csv.includes("新网点试点"));
      assert.ok(csv.includes("缺少归属规则"));
    });
    test("legacy reserve and non-dealer arrangements remain visible without loss", () => {
      let s = structuredClone(working);
      const i = s.initiatives.find((i) => i.ownerId === "MKT-1");
      delete i.otherBudgets;
      i.reserve = 300;
      i.reserveNote = "后续铺货";
      i.nonDealer = 200;
      i.nonDealerNote = "渠道活动";
      const rows = X.rawData(s, owner, D, "other-budgets").rows.filter(
        (r) => r.initiativeId === i.id,
      );
      assert.deepEqual(
        rows.map((r) => [
          r.otherBudgetReason,
          r.otherBudgetAmount,
          r.otherBudgetNote,
        ]),
        [
          ["新增经销商预留", 300, "后续铺货"],
          ["其他支出", 200, "渠道活动"],
        ],
      );
    });
    test("legacy published snapshots retain the original other-budget reason", () => {
      const s = structuredClone(submitted);
      const published = Object.values(s.publications)[0][0].initiative;
      delete published.otherBudgets;
      published.reserve = 30;
      published.reserveNote = "待开发网点";
      published.nonDealer = 20;
      published.nonDealerNote = "渠道服务";
      const rows = X.rawData(s, management, D, "other-budgets").rows.filter(
        (row) => row.initiativeId === published.id,
      );
      assert.deepEqual(
        rows.map((row) => [
          row.otherBudgetReason,
          row.otherBudgetAmount,
          row.otherBudgetNote,
        ]),
        [
          ["新增经销商预留", 30, "待开发网点"],
          ["其他支出", 20, "渠道服务"],
        ],
      );
    });
    console.log(`${checks} explore checks passed`);
  },
  30000,
);
