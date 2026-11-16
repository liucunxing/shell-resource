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


    test("管理员调整 Owner 后保留分配和发布档案，并切换读取权限", () => {
      const state = E.createState(data, "working");
      const item = state.initiatives.find((row) => row.department === "MKT" && row.ownerId === "MKT-1");
      const oldOwner = ownerFor(item);
      const newOwner = { role: "owner", department: "MKT", ownerId: "MKT-2" };
      E.publishInitiative(state, item.id, oldOwner, data, "调整前发布");
      const allocations = clone(item.rows);
      const publications = clone(state.publications[item.id]);
      const revision = item.revision;
      E.applyAdminConfiguration(state, [{ id: item.id, budget: item.budget, ownerId: newOwner.ownerId, revision }], { role: "admin" });
      assert.equal(item.ownerId, newOwner.ownerId);
      assert.equal(item.revision, revision + 1);
      assert.deepEqual(item.rows, allocations);
      assert.deepEqual(state.publications[item.id], publications);
      assert(!E.selectView(state, oldOwner).initiatives.some((row) => row.id === item.id));
      assert(E.selectView(state, newOwner).initiatives.some((row) => row.id === item.id));
      E.setOwner(state, item.id, oldOwner.ownerId, { role: "admin" });
      assert.equal(item.ownerId, oldOwner.ownerId);
      assert.deepEqual(item.rows, allocations);
    });



    console.log("PASS " + passed + " workflow/latest-publication checks");
  },
  30000,
);
