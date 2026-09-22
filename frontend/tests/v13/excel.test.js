import { test as vitestTest } from "vitest";
import assert from "node:assert/strict";
import X from "../../src/workbench/domain/excel.js";
import ExcelJS from "exceljs";

vitestTest(
  "V1.3 excel original regression contract",
  async () => {
    const identity = { role: "owner", department: "MKT", ownerId: "MKT-1" };
    const data = { dealers: [{ id: "D001" }, { id: "D002" }, { id: "D003" }] };
    const base = () => ({
      departments: {
        MKT: { status: "collecting", versions: [], comments: [] },
      },
      audit: [],
      budgetReasons: [
        { id: "reserve", label: "新增经销商预留", enabled: true },
        { id: "unallocated", label: "无法分配到经销商", enabled: true },
        { id: "other", label: "其他支出", enabled: true },
      ],
      initiatives: [
        {
          id: "I001",
          name: "示例活动",
          resourceType: "SP&A",
          sector: "工业",
          department: "MKT",
          ownerId: "MKT-1",
          budget: 100,
          revision: 1,
          rows: [
            { dealerId: "D001", amount: 60, note: "现有投入" },
            { dealerId: "D002", amount: 20, note: "" },
          ],
          otherBudgets: [
            { id: "OB-1", reasonId: "reserve", amount: 5, note: "新增客户" },
            { id: "OB-2", reasonId: "reserve", amount: 4, note: "第二批" },
            { id: "OB-3", reasonId: "other", amount: 1, note: "场地" },
          ],
        },
      ],
    });
    const copy = (x) => JSON.parse(JSON.stringify(x));
    async function alter(bytes, edit) {
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(bytes);
      edit(book);
      return book.xlsx.writeBuffer();
    }
    async function main() {
      const state = base(),
        bytes = await X.exportWorkbook(state, "I001", identity);
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(bytes);
      assert.deepEqual(
        book.worksheets.map((s) => s.name),
        ["模板信息", "经销商分配", "其他预算安排"],
      );
      assert.equal(book.getWorksheet("其他预算安排").rowCount, 4);
      assert.equal(
        book.getWorksheet("其他预算安排").getCell("B2").dataValidation.type,
        "list",
      );
      const unchanged = await X.previewImport(
        bytes,
        state,
        "I001",
        identity,
        data,
      );
      assert.deepEqual(unchanged.errors, []);
      assert.equal(unchanged.summary.gap, 10);
      assert.equal(unchanged.changes.length, 0);
      const before = JSON.stringify(state),
        writeBefore = state.initiatives[0].revision;
      X.confirmImport(unchanged, state, identity, data);
      assert.equal(state.initiatives[0].revision, writeBefore + 1);
      assert.equal(
        JSON.stringify(state.initiatives[0].otherBudgets),
        JSON.stringify(base().initiatives[0].otherBudgets),
      );
      assert.throws(
        () => X.confirmImport(unchanged, state, identity, data),
        /无效/,
      );
      assert.notEqual(JSON.stringify(state), before);

      const edited = await alter(bytes, (b) => {
        const other = b.getWorksheet("其他预算安排");
        other.getCell("C3").value = 6;
        other.addRow(["", "无法分配到经销商", 5, "无法匹配经销商"]);
      });
      const target = base(),
        preview = await X.previewImport(edited, target, "I001", identity, data);
      assert.deepEqual(preview.errors, []);
      assert.equal(JSON.stringify(target), JSON.stringify(base()));
      assert.equal(preview.otherBudgets.length, 4);
      assert.equal(
        preview.otherBudgets.filter((x) => x.reasonId === "reserve").length,
        2,
      );
      assert.equal(preview.otherBudgets.at(-1).reasonId, "unallocated");
      assert.equal(preview.summary.after, 97);
      X.confirmImport(preview, target, identity, data);
      assert.equal(target.initiatives[0].otherBudgets.length, 4);
      assert.equal(target.initiatives[0].otherBudgets[1].amount, 6);

      for (const [name, edit] of [
        [
          "未知原因",
          (b) =>
            (b.getWorksheet("其他预算安排").getCell("B2").value = "不存在"),
        ],
        [
          "空原因",
          (b) => (b.getWorksheet("其他预算安排").getCell("D2").value = ""),
        ],
        [
          "负金额",
          (b) => (b.getWorksheet("其他预算安排").getCell("C2").value = -1),
        ],
        [
          "重复预算项编号",
          (b) => (b.getWorksheet("其他预算安排").getCell("A3").value = "OB-1"),
        ],
        [
          "公式",
          (b) =>
            (b.getWorksheet("其他预算安排").getCell("C2").value = {
              formula: "1+1",
              result: 2,
            }),
        ],
      ]) {
        const s = base(),
          snapshot = JSON.stringify(s),
          bad = await X.previewImport(
            await alter(bytes, edit),
            s,
            "I001",
            identity,
            data,
          );
        assert.ok(bad.errors.length, name);
        assert.throws(() => X.confirmImport(bad, s, identity, data));
        assert.equal(JSON.stringify(s), snapshot, name);
      }
      const stale = base(),
        stalePreview = await X.previewImport(
          bytes,
          stale,
          "I001",
          identity,
          data,
        );
      stale.initiatives[0].revision++;
      assert.throws(
        () => X.confirmImport(stalePreview, stale, identity, data),
        /版本|属性/,
      );
      const published = base();
      published.publications = { I001: [{ id: "PUB-1" }] };
      const publishedBytes = await X.exportWorkbook(
        published,
        "I001",
        identity,
      );
      assert.deepEqual(
        (
          await X.previewImport(
            publishedBytes,
            published,
            "I001",
            identity,
            data,
          )
        ).errors,
        [],
      );
      const denied = await X.previewImport(
        bytes,
        base(),
        "I001",
        { ...identity, ownerId: "MKT-2" },
        data,
      );
      assert.ok(denied.errors.length);

      const legacy = new ExcelJS.Workbook(),
        meta = legacy.addWorksheet("模板信息"),
        dealers = legacy.addWorksheet("经销商分配"),
        pool = legacy.addWorksheet("预算池");
      meta.addRow(["字段", "值（固定属性请勿修改)"]); // corrected below to ensure normal legacy header
      meta.getCell("B1").value = "值（固定属性请勿修改）";
      const i = base().initiatives[0],
        legacyValues = [
          "资源投资分配模板 V1.2",
          i.id,
          i.name,
          i.resourceType,
          i.sector,
          i.department,
          i.ownerId,
          i.budget,
          i.revision,
        ];
      [
        "模板版本",
        "Initiative编号",
        "Initiative名称",
        "资源类型",
        "Sector",
        "部门",
        "Owner编号",
        "预算（只读）",
        "草稿修订号",
      ].forEach((label, n) => meta.addRow([label, legacyValues[n]]));
      meta.addRow(["填写说明", "旧模板"]);
      dealers.addRow(["行业务键", "经销商编码", "分配金额", "说明"]);
      i.rows.forEach((r) =>
        dealers.addRow([
          i.id + "::" + r.dealerId,
          r.dealerId,
          r.amount,
          r.note,
        ]),
      );
      pool.addRow(["预算池类型", "金额", "说明"]);
      pool.addRow(["新增经销商预留", 5, "旧预留"]);
      pool.addRow(["非经销商支出", 3, "旧其他"]);
      const legacyPreview = await X.previewImport(
        await legacy.xlsx.writeBuffer(),
        base(),
        "I001",
        identity,
        data,
      );
      assert.deepEqual(legacyPreview.errors, []);
      assert.deepEqual(
        legacyPreview.otherBudgets.map((r) => r.reasonId),
        ["reserve", "other"],
      );
      console.log(
        "PASS: V1.3 other-budget Excel preserves arbitrary rows and same reasons; validates reason/amount/note/IDs; published remains editable; V1.2 imports without lossy merging.",
      );
    }
    await main();
  },
  30000,
);
