import { test as vitestTest } from "vitest";
import assert from "node:assert/strict";
import E from "../../src/workbench/domain/engine.js";
import data from "../../src/workbench/domain/demo-data.json";

vitestTest(
  "V1.3 budget-balance original regression contract",
  async () => {
    const clone = (value) => JSON.parse(JSON.stringify(value));
    const ownerFor = (item) => ({
      role: "owner",
      department: item.department,
      ownerId: item.ownerId,
    });
    const firstMkt = (state) =>
      state.initiatives.find(
        (item) => item.department === "MKT" && item.ownerId === "MKT-1",
      );
    let count = 0;
    function test(name, run) {
      run();
      count += 1;
      console.log("PASS " + name);
    }
    function reduceFirstDealer(state, item, amount) {
      const rows = clone(item.rows);
      const index = rows.findIndex((row) => row.amount >= amount);
      assert.notEqual(index, -1, "需要至少一条可调减的经销商分配");
      rows[index].amount -= amount;
      E.updateInitiative(state, item.id, { rows }, ownerFor(item), data);
    }

    test("正差额仅写入专用未分配行，金额精确且不改经销商或人工行", () => {
      const state = E.createState(data, "working");
      const item = firstMkt(state);
      const owner = ownerFor(item);
      E.generateInsight(state, "initiative:" + item.id, owner, { data });
      const dealerBefore = clone(item.rows);
      reduceFirstDealer(state, item, 12.34);
      const unauthorized = JSON.stringify(state);
      assert.throws(
        () =>
          E.balanceOtherBudget(
            state,
            item.id,
            { role: "owner", department: "MKT", ownerId: "MKT-2" },
            data,
          ),
        /仅当前 Initiative 的 Owner/,
      );
      assert.equal(JSON.stringify(state), unauthorized);
      const revisionBefore = item.revision;
      const auditBefore = state.audit.length;
      const result = E.balanceOtherBudget(state, item.id, owner, data);
      assert.deepEqual(result, {
        changed: true,
        delta: 12.34,
        rowId: "OB-BALANCE-" + item.id,
        reasonId: "unallocated",
      });
      assert.deepEqual(
        item.rows,
        dealerBefore.map((row, index) =>
          index === 0
            ? Object.assign({}, row, { amount: row.amount - 12.34 })
            : row,
        ),
      );
      const balance = item.otherBudgets.find((row) => row.id === result.rowId);
      assert.deepEqual(balance, {
        id: result.rowId,
        reasonId: "unallocated",
        amount: 12.34,
        note: "未分配至经销商的剩余预算，待后续落实",
      });
      assert.equal(E.totals([item]).gap, 0);
      assert.equal(item.revision, revisionBefore + 1);
      assert.equal(state.audit.length, auditBefore + 1);
      assert.equal(state.audit.at(-1).action, "balance_other_budget");
      assert.equal(E.insightIsStale(state, "initiative:" + item.id), true);
    });

    test("零差额严格无操作；超支只可扣减专用余额且保留人工说明", () => {
      const state = E.createState(data, "working");
      const item = firstMkt(state);
      const owner = ownerFor(item);
      const before = JSON.stringify(state);
      assert.deepEqual(E.balanceOtherBudget(state, item.id, owner, data), {
        changed: false,
        delta: 0,
        rowId: null,
        reasonId: "unallocated",
      });
      assert.equal(JSON.stringify(state), before);
      E.updateInitiative(
        state,
        item.id,
        {
          otherBudgets: [
            {
              id: "OB-BALANCE-" + item.id,
              reasonId: "unallocated",
              amount: 10,
              note: "人工补充说明",
            },
          ],
        },
        owner,
        data,
      );
      assert.equal(E.totals([item]).gap, -10);
      const result = E.balanceOtherBudget(state, item.id, owner, data);
      assert.equal(result.delta, -10);
      assert.equal(item.otherBudgets[0].amount, 0);
      assert.equal(item.otherBudgets[0].note, "人工补充说明");
      assert.equal(E.totals([item]).gap, 0);
      reduceFirstDealer(state, item, -5);
      const rejected = JSON.stringify(state);
      assert.throws(
        () => E.balanceOtherBudget(state, item.id, owner, data),
        /余额不足/,
      );
      assert.equal(JSON.stringify(state), rejected);
    });

    test("专用行被改为人工原因或未分配原因停用时，自动平衡拒绝且不写入", () => {
      const state = E.createState(data, "working");
      const item = firstMkt(state);
      const owner = ownerFor(item);
      reduceFirstDealer(state, item, 5);
      E.updateInitiative(
        state,
        item.id,
        {
          otherBudgets: [
            {
              id: "OB-BALANCE-" + item.id,
              reasonId: "other",
              amount: 0,
              note: "人工保留行",
            },
          ],
        },
        owner,
        data,
      );
      const manual = JSON.stringify(state);
      assert.throws(
        () => E.balanceOtherBudget(state, item.id, owner, data),
        /人工调整/,
      );
      assert.equal(JSON.stringify(state), manual);
      const clean = E.createState(data, "working");
      const cleanItem = firstMkt(clean);
      reduceFirstDealer(clean, cleanItem, 5);
      const reasons = E.getBudgetReasons(clean, { role: "admin" });
      reasons.find((row) => row.id === "unallocated").enabled = false;
      E.setBudgetReasons(clean, reasons, { role: "admin" });
      const disabled = JSON.stringify(clean);
      assert.throws(
        () =>
          E.balanceOtherBudget(clean, cleanItem.id, ownerFor(cleanItem), data),
        /未启用/,
      );
      assert.equal(JSON.stringify(clean), disabled);
      const reduceExisting = E.createState(data, "working");
      const reduceItem = firstMkt(reduceExisting);
      E.updateInitiative(
        reduceExisting,
        reduceItem.id,
        {
          otherBudgets: [
            {
              id: "OB-BALANCE-" + reduceItem.id,
              reasonId: "unallocated",
              amount: 5,
              note: "已登记未分配余额",
            },
          ],
        },
        ownerFor(reduceItem),
        data,
      );
      const disabledReasons = E.getBudgetReasons(reduceExisting, {
        role: "admin",
      });
      disabledReasons.find((row) => row.id === "unallocated").enabled = false;
      E.setBudgetReasons(reduceExisting, disabledReasons, { role: "admin" });
      assert.equal(
        E.balanceOtherBudget(
          reduceExisting,
          reduceItem.id,
          ownerFor(reduceItem),
          data,
        ).delta,
        -5,
      );
      assert.equal(reduceItem.otherBudgets[0].amount, 0);
    });

    test("未分配 Mock 场景不改源数据，跨部门发布均有小于 100% 的分配比例", () => {
      const sourceBefore = JSON.stringify(data);
      const baseline = E.createState(data, "working");
      const state = E.createState(data, "unallocated");
      assert.equal(JSON.stringify(data), sourceBefore);
      assert.equal(state.initiatives.length, 75);
      assert.equal(
        E.totals(state.initiatives).budget,
        E.totals(baseline.initiatives).budget,
      );
      assert.equal(state.demoScenario.label, "Mock · 含未分配预算示例");
      const unfinished = state.initiatives.find(
        (item) => item.id === state.demoScenario.unfinishedInitiativeId,
      );
      assert(E.totals([unfinished]).gap > 0);
      const mktOneReasons = new Set(
        state.initiatives
          .filter(
            (item) =>
              item.department === "MKT" &&
              item.ownerId === "MKT-1" &&
              item.id !== unfinished.id,
          )
          .flatMap((item) => item.otherBudgets)
          .filter((row) => row.amount > 0)
          .map((row) => row.reasonId),
      );
      assert.deepEqual([...mktOneReasons].sort(), [
        "other",
        "reserve",
        "unallocated",
      ]);
      assert.equal(Object.keys(state.publications).length, 74);
      for (const dep of E.DEPARTMENTS) {
        const summary = E.selectView(state, { role: "management" }).summaries[
          dep
        ];
        assert(summary && summary.budget > 0);
        assert(
          summary.allocated / summary.budget < 1,
          dep + " 应展示未完全分配",
        );
      }
      Object.values(state.publications)
        .flat()
        .forEach((publication) => {
          assert.deepEqual(
            E.completionErrors(
              publication.initiative,
              data,
              state.budgetReasons,
            ),
            [],
          );
        });
    });

    test("平衡工作稿不会改已发布快照，重复发布后才成为管理层最新版本", () => {
      const state = E.createState(data, "unallocated");
      const item = state.initiatives.find(
        (item) => item.department === "ICE" && state.publications[item.id],
      );
      const owner = ownerFor(item);
      const published = E.latestPublication(state, item.id, owner);
      reduceFirstDealer(state, item, 1.11);
      E.balanceOtherBudget(state, item.id, owner, data);
      assert.deepEqual(E.latestPublication(state, item.id, owner), published);
      const next = E.publishInitiative(
        state,
        item.id,
        owner,
        data,
        "补齐未分配预算后再次发布",
      );
      assert.notEqual(next.id, published.id);
      assert.equal(E.latestPublication(state, item.id, owner).id, next.id);
    });

    test("其他预算按原因汇总，兼容总额守恒且 Owner 仅获得本部门汇总", () => {
      const state = E.createState(data, "working");
      const item = firstMkt(state);
      const owner = ownerFor(item);
      const reasons = E.getBudgetReasons(state, { role: "admin" });
      reasons.push({ id: "contract", label: "合同服务", enabled: true });
      E.setBudgetReasons(state, reasons, { role: "admin" });
      E.updateInitiative(
        state,
        item.id,
        {
          otherBudgets: [
            { id: "OB-r", reasonId: "reserve", amount: 2, note: "预留" },
            { id: "OB-u", reasonId: "unallocated", amount: 3, note: "未分配" },
            { id: "OB-o", reasonId: "other", amount: 4, note: "其他" },
            { id: "OB-c", reasonId: "contract", amount: 5, note: "合同" },
          ],
        },
        owner,
        data,
      );
      const total = E.totals([item]);
      assert.deepEqual(total.otherBudgetByReason, [
        { reasonId: "contract", amount: 5 },
        { reasonId: "other", amount: 4 },
        { reasonId: "reserve", amount: 2 },
        { reasonId: "unallocated", amount: 3 },
      ]);
      assert.equal(total.otherBudget, 14);
      assert.equal(total.reserve, 2);
      assert.equal(total.nonDealer, 12);
      assert.equal(total.reserve + total.nonDealer, total.otherBudget);
      const ownerView = E.selectView(state, owner);
      assert.deepEqual(Object.keys(ownerView.summaries), ["MKT"]);
      assert(
        ownerView.summaries.MKT.otherBudgetByReason.some(
          (row) => row.reasonId === "contract",
        ),
      );
      assert.equal(
        ownerView.initiatives.every((row) => row.ownerId === owner.ownerId),
        true,
      );
      assert(!JSON.stringify(ownerView).includes("ICE Rebate"));
    });

    console.log("PASS " + count + " budget-balance checks");
  },
  30000,
);
