import { test as vitestTest } from "vitest";
import assert from "node:assert/strict";
import E from "../../src/workbench/domain/engine.js";
import data from "../../src/workbench/domain/demo-data.json";

vitestTest(
  "V1.3 workflow-latest original regression contract",
  async () => {
    const clone = (value) => JSON.parse(JSON.stringify(value));
    const ownerFor = (item) => ({
      role: "owner",
      department: item.department,
      ownerId: item.ownerId,
    });
    let passed = 0;
    function test(name, run) {
      run();
      passed += 1;
      console.log("PASS " + name);
    }

    test("Owner 可以反复发布，管理层只读取每项最新发布版本", () => {
      const state = E.createState(data, "working");
      const item = state.initiatives.find((row) => row.department === "MKT");
      const owner = ownerFor(item);
      const first = E.publishInitiative(
        state,
        item.id,
        owner,
        data,
        "第一次发布",
      );
      const before = E.selectView(state, { role: "management" });
      assert.equal(
        before.initiatives.find((row) => row.id === item.id).budget,
        item.budget,
      );
      const rows = clone(item.rows);
      rows[0].amount -= 10;
      E.updateInitiative(
        state,
        item.id,
        {
          rows,
          otherBudgets: [
            { id: "OB-1", reasonId: "reserve", amount: 10, note: "新网点拓展" },
          ],
        },
        owner,
        data,
      );
      assert.equal(
        E.selectView(state, { role: "management" }).initiatives.find(
          (row) => row.id === item.id,
        ).revision,
        first.publishedRevision,
      );
      const second = E.publishInitiative(
        state,
        item.id,
        owner,
        data,
        "调整后再次发布",
      );
      const latest = E.latestPublication(state, item.id, owner);
      assert.equal(latest.id, second.id);
      assert.equal(latest.number, 2);
      assert.equal(
        E.selectView(state, { role: "management" }).initiatives.find(
          (row) => row.id === item.id,
        ).revision,
        item.revision,
      );
      assert.equal(E.canEdit(state, item.id, owner), true);
    });

    test("其他预算行支持原因字典、金额与说明，并保留兼容汇总", () => {
      const state = E.createState(data, "working");
      const item = state.initiatives.find((row) => row.department === "ICE");
      const owner = ownerFor(item);
      const nextReasons = E.getBudgetReasons(state, owner).concat([
        { id: "contract", label: "合同服务", enabled: true },
      ]);
      E.setBudgetReasons(state, nextReasons, { role: "admin" });
      const rows = clone(item.rows);
      rows[0].amount -= 15;
      E.updateInitiative(
        state,
        item.id,
        {
          rows,
          otherBudgets: [
            {
              id: "OB-contract",
              reasonId: "contract",
              amount: 15,
              note: "第三方执行服务",
            },
          ],
        },
        owner,
        data,
      );
      const total = E.totals([item]);
      assert.equal(total.otherBudget, 15);
      assert.equal(total.gap, 0);
      assert.throws(
        () =>
          E.setBudgetReasons(
            state,
            E.getBudgetReasons(state, owner).filter(
              (row) => row.id !== "contract",
            ),
            { role: "admin" },
          ),
        /仍被预算行使用/,
      );
      E.updateInitiative(
        state,
        item.id,
        {
          otherBudgets: [
            { id: "bad", reasonId: "contract", amount: 15, note: "" },
          ],
        },
        owner,
        data,
      );
      assert.throws(
        () => E.publishInitiative(state, item.id, owner, data),
        /须填写原因说明/,
      );
    });

    test("旧锁定状态迁移为可编辑，旧预算池不丢失", () => {
      const state = E.createState(data, "working");
      const item = state.initiatives[0];
      delete item.otherBudgets;
      item.reserve = 12;
      item.reserveNote = "旧预留";
      item.nonDealer = 8;
      item.nonDealerNote = "旧其他支出";
      state.schemaVersion = 1;
      state.departments[item.department].status = "submitted";
      state.final = { id: "OLD-FINAL" };
      E.migrateState(state);
      assert.equal(state.final, null);
      assert.equal(state.legacyFinal.id, "OLD-FINAL");
      assert.equal(state.departments[item.department].status, "collecting");
      assert.deepEqual(
        item.otherBudgets.map((row) => [row.reasonId, row.amount, row.note]),
        [
          ["reserve", 12, "旧预留"],
          ["other", 8, "旧其他支出"],
        ],
      );
    });

    test("Owner Insight 仅限本人汇总或单个 Initiative，提示词可编辑", () => {
      const state = E.createState(data, "working");
      const mine = state.initiatives.find((row) => row.department === "MKT");
      const other = state.initiatives.find(
        (row) => row.department === "MKT" && row.ownerId !== mine.ownerId,
      );
      const owner = ownerFor(mine);
      const aggregateScope = "owner:" + owner.ownerId;
      const singleScope = "initiative:" + mine.id;
      const aggregate = E.generateInsight(state, aggregateScope, owner, {
        data,
      });
      const single = E.generateInsight(state, singleScope, owner, { data });
      assert.equal(aggregate.scope, aggregateScope);
      assert.equal(single.scope, singleScope);
      assert.equal(
        E.getAnalysisPrompt(state, singleScope, owner).editable,
        true,
      );
      E.setAnalysisPrompt(
        state,
        singleScope,
        "仅用本人项目数据复核六点。",
        owner,
      );
      assert.throws(
        () => E.getInsight(state, "initiative:" + other.id, owner),
        /无权/,
      );
      assert.throws(
        () =>
          E.generateInsight(state, "owner:" + other.ownerId, owner, { data }),
        /无权/,
      );
    });

    test("管理员改 Owner 会清除原 Owner、新 Owner 与单项目 Insight 缓存", () => {
      const state = E.createState(data, "working");
      const item = state.initiatives.find(
        (row) => row.department === "MKT" && row.ownerId === "MKT-1",
      );
      const oldOwner = ownerFor(item);
      const newOwner = { role: "owner", department: "MKT", ownerId: "MKT-2" };
      E.generateInsight(state, "owner:" + oldOwner.ownerId, oldOwner, { data });
      E.generateInsight(state, "initiative:" + item.id, oldOwner, { data });
      E.generateInsight(state, "owner:" + newOwner.ownerId, newOwner, { data });
      E.setAnalysisPrompt(
        state,
        "owner:" + oldOwner.ownerId,
        "旧 Owner 提示词",
        oldOwner,
      );
      E.setAnalysisPrompt(
        state,
        "initiative:" + item.id,
        "旧项目提示词",
        oldOwner,
      );
      E.setAnalysisPrompt(
        state,
        "owner:" + newOwner.ownerId,
        "新 Owner 提示词",
        newOwner,
      );
      E.applyAdminConfiguration(
        state,
        [
          {
            id: item.id,
            budget: item.budget,
            ownerId: newOwner.ownerId,
            revision: item.revision,
          },
        ],
        { role: "admin" },
      );
      assert.equal(state.insights["owner:" + oldOwner.ownerId], undefined);
      assert.equal(state.insights["owner:" + newOwner.ownerId], undefined);
      assert.equal(state.insights["initiative:" + item.id], undefined);
      assert.equal(
        state.analysisPrompts["owner:" + oldOwner.ownerId],
        undefined,
      );
      assert.equal(
        state.analysisPrompts["owner:" + newOwner.ownerId],
        undefined,
      );
      assert.equal(state.analysisPrompts["initiative:" + item.id], undefined);
      assert.equal(
        E.selectView(state, oldOwner).insights["owner:" + oldOwner.ownerId],
        undefined,
      );
      E.generateInsight(state, "owner:" + newOwner.ownerId, newOwner, { data });
      E.generateInsight(state, "initiative:" + item.id, newOwner, { data });
      E.setAnalysisPrompt(
        state,
        "initiative:" + item.id,
        "交接后的提示词",
        newOwner,
      );
      E.setOwner(state, item.id, oldOwner.ownerId, { role: "admin" });
      assert.equal(state.insights["owner:" + newOwner.ownerId], undefined);
      assert.equal(state.insights["initiative:" + item.id], undefined);
      assert.equal(state.analysisPrompts["initiative:" + item.id], undefined);
    });

    test("管理层只读预览基于已发布项目，不能写入 Insight 或审批状态", () => {
      const state = E.createState(data, "working");
      const item = state.initiatives[0];
      E.publishInitiative(state, item.id, ownerFor(item), data);
      const auditLength = state.audit.length;
      const preview = E.previewInsight(
        state,
        "global",
        { role: "management" },
        { data },
      );
      assert.equal(preview.items.length, 6);
      assert.equal(state.audit.length, auditLength);
      assert.equal(state.insights.global, undefined);
      assert.throws(
        () =>
          E.generateInsight(state, "global", { role: "management" }, { data }),
        /只读预览/,
      );
      assert.throws(() => E.finalize(state, { role: "management" }));
      assert.throws(() =>
        E.returnDepartment(state, item.department, "请调整", {
          role: "management",
        }),
      );
    });

    test("原因标签变更会使 Insight 失效，并使用当前管理员配置的名称", () => {
      const state = E.createState(data, "working");
      const item = state.initiatives.find(
        (row) => row.department === "MKT" && row.ownerId === "MKT-1",
      );
      const owner = ownerFor(item);
      const rows = clone(item.rows);
      rows[0].amount -= 10;
      E.updateInitiative(
        state,
        item.id,
        {
          rows,
          otherBudgets: [
            {
              id: "OB-reserve",
              reasonId: "reserve",
              amount: 10,
              note: "新渠道储备",
            },
          ],
        },
        owner,
        data,
      );
      const scope = "initiative:" + item.id;
      E.generateInsight(state, scope, owner, { data });
      assert.match(
        E.getInsight(state, scope, owner).items[5].evidence,
        /新增经销商预留/,
      );
      const reasons = E.getBudgetReasons(state, { role: "admin" });
      reasons.find((row) => row.id === "reserve").label = "临时市场费用";
      E.setBudgetReasons(state, reasons, { role: "admin" });
      assert.equal(E.insightIsStale(state, scope), true);
      const refreshed = E.generateInsight(state, scope, owner, { data });
      assert.match(refreshed.items[5].evidence, /临时市场费用/);
      assert.doesNotMatch(refreshed.items[5].evidence, /新增经销商预留/);
    });

    console.log("PASS " + passed + " workflow/latest-publication checks");
  },
  30000,
);
