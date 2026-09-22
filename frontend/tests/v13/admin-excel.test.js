import { test as vitestTest } from "vitest";
import assert from "node:assert/strict";
import E from "../../src/workbench/domain/engine.js";
import X from "../../src/workbench/domain/admin-excel.js";
import ExcelJS from "exceljs";
import data from "../../src/workbench/domain/demo-data.json";

vitestTest(
  "V1.3 admin-excel original regression contract",
  async () => {
    const admin = { role: "admin" },
      owner = { role: "owner", department: "MKT", ownerId: "MKT-1" };
    const fresh = () => E.createState(data, "working");
    const copy = (v) => JSON.parse(JSON.stringify(v));
    let passed = 0;
    async function check(name, run) {
      await run();
      passed++;
      console.log("PASS " + name);
    }
    async function alter(bytes, fn) {
      const b = new ExcelJS.Workbook();
      await b.xlsx.load(bytes);
      fn(b.getWorksheet("预算与归属"), b);
      return b.xlsx.writeBuffer();
    }
    async function main() {
      const base = fresh(),
        bytes = await X.exportWorkbook(base, admin);
      const first = base.initiatives[0];
      const changedBytes = await alter(bytes, (s) => {
        s.getCell("G2").value = first.budget + 100;
        s.getCell("F2").value = first.department + "-2";
      });
      await check(
        "export workbook is configuration only and no-op import does not reset completion",
        async () => {
          const b = new ExcelJS.Workbook();
          await b.xlsx.load(bytes);
          assert.equal(b.worksheets.length, 2);
          assert.equal(b.getWorksheet("预算与归属").rowCount, 76);
          assert.ok(!JSON.stringify(b.model).includes("经销商编码"));
          const before = JSON.stringify(base),
            p = await X.previewImport(bytes, base, admin);
          assert.deepEqual(p.errors, []);
          assert.equal(p.changes.length, 0);
          assert.equal(p.unchanged, 75);
          assert.throws(() => X.confirmImport(p, base, admin), /没有变化/);
          assert.equal(JSON.stringify(base), before);
        },
      );
      await check(
        "changed budgets and owners preview without writes then commit once",
        async () => {
          const s = copy(base),
            before = JSON.stringify(s),
            p = await X.previewImport(changedBytes, s, admin);
          assert.deepEqual(p.errors, []);
          assert.equal(p.changes.length, 1);
          assert.equal(p.summary.after, p.summary.before + 100);
          assert.equal(JSON.stringify(s), before);
          const unchanged = copy(s.initiatives.slice(1)),
            allocations = copy(s.initiatives[0].rows),
            revision = s.initiatives[0].revision;
          assert.deepEqual(X.confirmImport(p, s, admin), [first.id]);
          assert.equal(s.initiatives[0].budget, first.budget + 100);
          assert.equal(s.initiatives[0].ownerId, first.department + "-2");
          assert.equal(s.initiatives[0].revision, revision + 1);
          assert.equal(s.initiatives[0].status, "editing");
          assert.deepEqual(s.initiatives[0].rows, allocations);
          assert.deepEqual(s.initiatives.slice(1), unchanged);
          assert.equal(s.audit.at(-1).action, "import_admin_configuration");
          assert.throws(() => X.confirmImport(p, s, admin), /预览无效/);
        },
      );
      await check(
        "partial workbook updates only included existing projects",
        async () => {
          const s = copy(base),
            partial = await alter(changedBytes, (sh) => {
              for (let row = 3; row <= 76; row++) sh.getRow(row).values = [];
            });
          const p = await X.previewImport(partial, s, admin);
          assert.deepEqual(p.errors, []);
          assert.equal(p.rows, 1);
          X.confirmImport(p, s, admin);
          assert.equal(s.initiatives.length, 75);
          assert.deepEqual(s.initiatives.slice(1), base.initiatives.slice(1));
        },
      );
      const invalid = [
        ["negative budget", (sh) => (sh.getCell("G2").value = -1)],
        ["blank budget", (sh) => (sh.getCell("G2").value = null)],
        ["fraction precision", (sh) => (sh.getCell("G2").value = 1.001)],
        [
          "formula",
          (sh) => (sh.getCell("G2").value = { formula: "1+1", result: 2 }),
        ],
        [
          "cross-department owner",
          (sh) =>
            (sh.getCell("F2").value =
              (first.department === "ICE" ? "MKT" : "ICE") + "-1"),
        ],
        [
          "invalid fixed column",
          (sh) => (sh.getCell("C2").value = "different"),
        ],
        ["unknown id", (sh) => (sh.getCell("A2").value = "new-initiative")],
        ["duplicate id", (sh) => sh.addRow(sh.getRow(2).values.slice(1))],
        ["missing header", (sh) => (sh.getCell("G1").value = "other")],
        ["extra column", (sh) => (sh.getCell("J1").value = "extra")],
        [
          "stale revision",
          (sh) => {
            sh.getCell("H2").value = 999;
            sh.getCell("G2").value = first.budget + 10;
          },
        ],
        [
          "wrong template version",
          (_, b) => (b.getWorksheet("模板说明").getCell("B2").value = "other"),
        ],
        [
          "empty rows",
          (sh) => {
            for (let row = 2; row <= 76; row++) sh.getRow(row).values = [];
          },
        ],
      ];
      for (const [name, edit] of invalid)
        await check(name + " rejects entire import", async () => {
          const s = copy(base),
            before = JSON.stringify(s),
            bad = await alter(bytes, edit),
            p = await X.previewImport(bad, s, admin);
          assert.ok(p.errors.length);
          assert.throws(() => X.confirmImport(p, s, admin));
          assert.equal(JSON.stringify(s), before);
        });
      await check("non-admin cannot export preview or confirm", async () => {
        const s = copy(base);
        await assert.rejects(() => X.exportWorkbook(s, owner), /管理员/);
        assert.ok((await X.previewImport(bytes, s, owner)).errors.length);
        const p = await X.previewImport(changedBytes, s, admin);
        assert.throws(() => X.confirmImport(p, s, owner), /管理员/);
      });
      await check(
        "corrupt workbook and preview tampering fail safely",
        async () => {
          const s = copy(base),
            p = await X.previewImport(Buffer.from("invalid"), s, admin);
          assert.ok(p.errors.length);
          const good = await X.previewImport(changedBytes, s, admin);
          good.changes[0].after.budget++;
          assert.throws(() => X.confirmImport(good, s, admin), /预览无效/);
          assert.deepEqual(s, base);
        },
      );
      await check(
        "state edits or lock after preview require new preview",
        async () => {
          for (const mutate of [
            (s) => s.initiatives[0].revision++,
            (s) => (s.departments[first.department].status = "submitted"),
            (s) => (s.final = { id: "final" }),
          ]) {
            const s = copy(base),
              p = await X.previewImport(changedBytes, s, admin);
            mutate(s);
            const before = JSON.stringify(s);
            assert.throws(() => X.confirmImport(p, s, admin), /已变化/);
            assert.equal(JSON.stringify(s), before);
          }
        },
      );
      await check(
        "published and legacy-final configurations remain importable",
        async () => {
          const s = E.createState(data, "submitted"),
            exported = await X.exportWorkbook(s, admin),
            changed = await alter(
              exported,
              (sh) => (sh.getCell("G2").value = first.budget + 1),
            ),
            p = await X.previewImport(changed, s, admin);
          assert.deepEqual(p.errors, []);
          const publishedBefore = JSON.stringify(s);
          X.confirmImport(p, s, admin);
          assert.notEqual(JSON.stringify(s), publishedBefore);
          const finalExport = await X.exportWorkbook(s, admin);
          s.final = { id: "FINAL-test" };
          const finalChanged = await alter(
            finalExport,
            (sh) => (sh.getCell("G2").value = first.budget + 2),
          );
          const finalPreview = await X.previewImport(finalChanged, s, admin);
          assert.deepEqual(finalPreview.errors, []);
        },
      );
      await check(
        "engine validates entire batch atomically with no allocation mutation",
        async () => {
          const s = copy(base),
            before = JSON.stringify(s),
            make = (i) => ({
              id: i.id,
              revision: i.revision,
              budget: i.budget + 1,
              ownerId: i.ownerId,
            });
          assert.throws(
            () =>
              E.applyAdminConfiguration(
                s,
                [
                  make(s.initiatives[0]),
                  { ...make(s.initiatives[1]), ownerId: "other" },
                ],
                admin,
              ),
            /Owner/,
          );
          assert.equal(JSON.stringify(s), before);
          assert.throws(
            () => E.applyAdminConfiguration(s, [make(s.initiatives[0])], owner),
            /无权/,
          );
        },
      );
      console.log(passed + " admin Excel checks passed.");
    }
    await main();
  },
  30000,
);
