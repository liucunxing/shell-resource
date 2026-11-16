import { test as vitestTest } from "vitest";
import assert from "node:assert/strict";
import E from "../../src/workbench/domain/engine.js";
import demoData from "../../src/workbench/domain/demo-data.json";

vitestTest(
  "V1.3 engine original regression contract",
  async () => {
    const data = {
      metadata: { unit: "原表单位" },
      dealers: [
        { id: "D1", name: null },
        { id: "D2", name: null },
      ],
      initiatives: [
        {
          id: "M1",
          name: "市场 1",
          resourceType: "MRD",
          sector: "A",
          budget: 100,
        },
        {
          id: "M2",
          name: "市场 2",
          resourceType: "SP&A",
          sector: "B",
          budget: 100,
        },
        {
          id: "S1",
          name: "销售 1",
          resourceType: "ICE Rebate",
          sector: "A",
          budget: 100,
        },
        {
          id: "C1",
          name: "资本 1",
          resourceType: "Capex",
          sector: "A",
          budget: 100,
        },
      ],
      allocations: ["M1", "M2", "S1", "C1"].flatMap((initiativeId) => [
        { initiativeId, dealerId: "D1", amount: 60 },
        { initiativeId, dealerId: "D2", amount: 40 },
      ]),
    };
    const owner = { role: "owner", department: "MKT", ownerId: "MKT-1" };
    const owner2 = { role: "owner", department: "MKT", ownerId: "MKT-2" };
    const lead = { role: "lead", department: "MKT" };
    const management = { role: "management" };
    const admin = { role: "admin" };
    const copy = (value) => JSON.parse(JSON.stringify(value));
    let count = 0;
    function check(name, run) {
      run();
      count += 1;
      console.log("PASS " + name);
    }
    check("角色映射与源数据隔离", () => {
      const s = E.createState(data);
      assert.equal(s.initiatives[0].ownerId, "MKT-1");
      assert.equal(s.initiatives[1].ownerId, "MKT-2");
      assert.equal(s.initiatives[2].department, "ICE");
      assert.equal(s.initiatives[0].status, "editing");
      assert.equal(s.initiatives[1].status, "completed");
      s.initiatives[0].rows[0].amount = 0;
      assert.equal(data.allocations[0].amount, 60);
    });
    check("Owner 归属、部门负责人、管理层及管理员不可代改", () => {
      const s = E.createState(data);
      assert(E.canEdit(s, "M1", owner));
      for (const person of [
        owner2,
        lead,
        management,
        admin,
        { role: "owner", department: "ICE", ownerId: "MKT-1" },
      ]) {
        assert(!E.canEdit(s, "M1", person));
        assert.throws(() =>
          E.updateInitiative(s, "M1", { reserve: 1 }, person, data),
        );
      }
      assert.throws(() =>
        E.updateInitiative(s, "M1", { budget: 200 }, owner, data),
      );
      assert.throws(() => E.setBudget(s, "M1", 200, owner));
      assert.throws(() => E.setBudget(s, "M1", 200, lead));
    });
    check("整批校验错误不产生局部写入或修订", () => {
      const s = E.createState(data);
      const before = JSON.stringify(s);
      for (const rows of [
        [{ dealerId: "D1", amount: -1 }],
        [{ dealerId: "D1", amount: 1.001 }],
        [{ dealerId: "D1", amount: Infinity }],
        [{ dealerId: "D1", amount: NaN }],
        [{ dealerId: "D1", amount: "5" }],
        [{ dealerId: "UNKNOWN", amount: 5 }],
        [
          { dealerId: "D1", amount: 5 },
          { dealerId: "D1", amount: 6 },
        ],
      ])
        assert.throws(() => E.updateInitiative(s, "M1", { rows }, owner, data));
      assert.throws(() =>
        E.updateInitiative(s, "M1", { reserve: -1 }, owner, data),
      );
      assert.equal(JSON.stringify(s), before);
    });
    check("分整数核算、小数精度、比例分母独立于当前分配", () => {
      const t = E.totals([
        {
          budget: 0.3,
          rows: [{ amount: 0.1 }, { amount: 0.2 }],
          reserve: 0,
          nonDealer: 0,
        },
      ]);
      assert.equal(t.gap, 0);
      const s = E.createState(data);
      const amountFromPercent =
        Math.round(s.initiatives[0].budget * 12.34) / 100;
      E.updateInitiative(
        s,
        "M1",
        { rows: [{ dealerId: "D1", amount: amountFromPercent }] },
        owner,
        data,
      );
      assert.equal(E.totals([s.initiatives[0]]).allocated, 12.34);
      assert.equal(E.totals([s.initiatives[0]]).budget, 100);
      assert.equal(E.totals([s.initiatives[0]]).gap, 87.66);
      assert.throws(() => E.complete(s, "M1", owner, data));
    });
    check("预算池和非经销商支出需独立说明，编辑自动取消完成", () => {
      const s = E.createState(data);
      E.updateInitiative(
        s,
        "M1",
        { rows: [{ dealerId: "D1", amount: 80 }], reserve: 10, nonDealer: 10 },
        owner,
        data,
      );
      assert.equal(E.totals([s.initiatives[0]]).gap, 0);
      assert.throws(() => E.complete(s, "M1", owner, data), /说明/);
      E.updateInitiative(
        s,
        "M1",
        { reserveNote: "新区域伙伴预留", nonDealerNote: "市场活动场租" },
        owner,
        data,
      );
      E.complete(s, "M1", owner, data);
      assert.equal(s.initiatives[0].status, "completed");
      const revision = s.initiatives[0].revision;
      E.updateInitiative(s, "M1", { reserveNote: "待新伙伴确认" }, owner, data);
      assert.equal(s.initiatives[0].status, "editing");
      assert.equal(s.initiatives[0].revision, revision + 1);
    });
    check("旧部门提交快照保留，但不会锁定 Owner 或管理员", () => {
      const s = E.createState(data);
      assert.throws(() => E.submit(s, "MKT", lead, data));
      E.complete(s, "M1", owner, data);
      assert.throws(() =>
        E.submit(s, "MKT", { role: "lead", department: "ICE" }, data),
      );
      const v = E.submit(s, "MKT", lead, data, "提交测试");
      assert.equal(v.number, 1);
      assert.equal(s.departments.MKT.status, "submitted");
      assert(E.canEdit(s, "M1", owner));
      E.reopen(s, "M1", owner);
      E.complete(s, "M1", owner, data);
      E.setBudget(s, "M1", 110, admin);
      E.returnInitiative(s, "M1", "调整", lead);
      v.initiatives[0].budget = 0;
      assert.equal(
        E.getSnapshot(s, "MKT", undefined, lead).initiatives[0].budget,
        100,
      );
    });
    check("完整演示数据迁移后保留 75 项及源预算基线，发布初始化不重复", () => {
      const expectedBudget = demoData.initiatives.reduce(
        (sum, item) => sum + item.budget,
        0,
      );
      const working = E.createState(demoData, "working");
      assert.equal(working.initiatives.length, 75);
      assert.equal(E.totals(working.initiatives).budget, expectedBudget);
      assert(
        working.initiatives.every((item) => Array.isArray(item.otherBudgets)),
      );
      const published = E.createState(demoData, "submitted");
      assert.equal(published.initiatives.length, 75);
      assert.equal(Object.keys(published.publications).length, 75);
      const before = JSON.stringify(published.publications);
      E.migrateState(published);
      E.migrateState(published);
      assert.equal(JSON.stringify(published.publications), before);
      assert.equal(E.totals(published.initiatives).budget, expectedBudget);
    });
    check("管理层没有审批写入口，Owner 可保留历史版本后再次发布", () => {
      const s = E.createState(data, "submitted");
      const before = JSON.stringify(s);
      assert.throws(
        () => E.returnDepartment(s, "MKT", "请调整", management),
        /只读/,
      );
      assert.throws(() => E.finalize(s, management), /只读/);
      assert.equal(JSON.stringify(s), before);
      const old = E.latestPublication(s, "M1", owner);
      E.updateInitiative(
        s,
        "M1",
        {
          rows: [
            { dealerId: "D1", amount: 50 },
            { dealerId: "D2", amount: 50 },
          ],
        },
        owner,
        data,
      );
      const next = E.publishInitiative(s, "M1", owner, data, "再次发布");
      assert.equal(next.number, old.number + 1);
      assert.equal(E.latestPublication(s, "M1", owner).id, next.id);
      assert.equal(
        E.selectView(s, management).initiatives.find((i) => i.id === "M1")
          .publicationId,
        next.id,
      );
    });
    check("管理员改预算不移动分配，重新完成前需平衡", () => {
      const s = E.createState(data);
      const rows = copy(s.initiatives[0].rows);
      E.setBudget(s, "M1", 110.01, admin);
      assert.deepEqual(s.initiatives[0].rows, rows);
      assert.equal(s.initiatives[0].status, "editing");
      assert.equal(E.totals([s.initiatives[0]]).gap, 10.01);
      assert.throws(() => E.complete(s, "M1", owner, data));
    });


    check(
      "发布版本读权限：Owner 本人、Lead 本部门、管理层全局；管理员只读分配内容",
      () => {
        const s = E.createState(data, "submitted");
        assert.throws(() => E.latestPublication(s, "M1"), /身份无效/);
        assert.throws(() => E.latestPublishedItems(s, "MKT"), /身份无效/);
        assert.throws(() => E.latestPublication(s, "M2", owner), /无权/);
        assert.throws(() => E.latestPublishedItems(s, "ICE", lead), /无权/);
        assert.equal(E.latestPublication(s, "M1", owner).initiativeId, "M1");
        assert.equal(E.latestPublishedItems(s, "MKT", lead).length, 2);
        assert.equal(
          E.latestPublication(s, "S1", management).initiativeId,
          "S1",
        );
        assert.ok(E.latestPublication(s, "M1", admin));
      },
    );
    check("Owner 重新归属后，旧部门快照也按当前归属过滤", () => {
      const s = E.createState(data);
      E.complete(s, "M1", owner, data);
      const version = E.submit(s, "MKT", lead, data, "历史部门提交");
      assert.deepEqual(
        E.getSnapshot(s, "MKT", version.id, owner).initiatives.map((i) => i.id),
        ["M1"],
      );
      E.setOwner(s, "M1", "MKT-2", admin);
      assert.deepEqual(
        E.getSnapshot(s, "MKT", version.id, owner).initiatives,
        [],
      );
    });

    check("Owner 提交快照剔除部门备注，保留本人行及版本元数据", () => {
      const s = E.createState(data);
      E.complete(s, "M1", owner, data);
      const v = E.submit(s, "MKT", lead, data, "PRIVATE-SUBMISSION-NOTE");
      const own = E.getSnapshot(s, "MKT", v.id, owner);
      assert.deepEqual(own.initiatives.map((i) => i.id), ["M1"]);
      assert(!own.note);
      assert(!JSON.stringify(own).includes("PRIVATE-SUBMISSION-NOTE"));
      assert.equal(own.reference.batchId, v.reference.batchId);
      assert.equal(E.getSnapshot(s, "MKT", v.id, lead).note, "PRIVATE-SUBMISSION-NOTE");
    });

    check(
      "统一工作稿 selector：Owner 序列化不含同事行和其它部门草稿，Lead 仅本部门",
      () => {
        const s = E.createState(data);
        s.initiatives.find((i) => i.id === "M2").rows[0].note =
          "PRIVATE-COWORKER-DRAFT";
        s.initiatives.find((i) => i.id === "S1").rows[0].note =
          "PRIVATE-ICE-DRAFT";
        s.initiatives.find((i) => i.id === "C1").rows[0].note =
          "PRIVATE-CAPEX-DRAFT";
        s.departments.MKT.comments.push({
          initiativeId: "M2",
          text: "PRIVATE-COWORKER-COMMENT",
        });
        const view = E.selectView(s, owner);
        assert.deepEqual(
          view.initiatives.map((i) => i.id),
          ["M1"],
        );
        assert.equal(view.summaries.MKT.budget, 200);
        assert.equal(view.summaries.MKT.initiativeCount, 2);
        const serialized = JSON.stringify(view);
        for (const secret of [
          "PRIVATE-",
          '"M2"',
          '"S1"',
          '"C1"',
          "SP&A",
          "ICE Rebate",
          "Capex",
          "MKT-2",
        ])
          assert(!serialized.includes(secret), secret);
        const leadView = E.selectView(s, lead);
        assert.deepEqual(
          leadView.initiatives.map((i) => i.id),
          ["M1", "M2"],
        );
        assert(!JSON.stringify(leadView).includes("PRIVATE-ICE-DRAFT"));
        view.initiatives[0].rows[0].amount = 999;
        assert.equal(s.initiatives[0].rows[0].amount, 60);
        assert.throws(() => E.selectView(s, null));
      },
    );
    check(
      "Management selector 只取已发布版本，草稿不泄漏给管理层，管理员可读工作稿",
      () => {
        const s = E.createState(data);
        s.initiatives[0].rows[0].note = "PRIVATE-COLLECTING-DRAFT";
        let view = E.selectView(s, management);
        assert.equal(view.initiatives.length, 0);
        assert.equal(view.departments.MKT.publishedCount, 0);
        assert(!JSON.stringify(view).includes("PRIVATE-COLLECTING-DRAFT"));
        E.publishInitiative(s, "M1", owner, data);
        view = E.selectView(s, management);
        assert.equal(view.initiatives.length, 1);
        s.initiatives[0].rows[0].note = "PRIVATE-NEW-DRAFT";
        assert(
          !JSON.stringify(E.selectView(s, management)).includes(
            "PRIVATE-NEW-DRAFT",
          ),
        );
        const adminView = E.selectView(s, admin);
        assert.equal(adminView.initiatives.length, 4);
        assert(JSON.stringify(adminView).includes('"rows"'));
        assert(JSON.stringify(adminView).includes("PRIVATE-NEW-DRAFT"));
      },
    );
    check("旧部门版本迁移为项目发布档案，反复迁移不重复或改变基线", () => {
      const legacy = E.createState(data);
      E.complete(legacy, "M1", owner, data);
      E.submit(legacy, "MKT", lead, data, "旧部门版本");
      legacy.schemaVersion = 1;
      delete legacy.publications;
      const initialBudget = legacy.initiatives.reduce(
        (n, item) => n + item.budget,
        0,
      );
      E.migrateState(legacy);
      const once = JSON.stringify(legacy.publications);
      E.migrateState(legacy);
      assert.equal(JSON.stringify(legacy.publications), once);
      assert.equal(legacy.initiatives.length, 4);
      assert.equal(
        legacy.initiatives.reduce((n, item) => n + item.budget, 0),
        initialBudget,
      );
      assert.equal(E.latestPublication(legacy, "M1", owner).initiativeId, "M1");
    });
    check("管理层没有退回或定稿流程，Owner 可用相同金额反复发布", () => {
      const s = E.createState(data, "submitted");
      const first = E.latestPublication(s, "M1", owner);
      const before = JSON.stringify(s);
      assert.throws(
        () => E.returnDepartment(s, "MKT", "请线下调整", management),
        /只读/,
      );
      assert.throws(() => E.finalize(s, management), /只读/);
      assert.equal(JSON.stringify(s), before);
      const second = E.publishInitiative(s, "M1", owner, data, "确认最新版本");
      assert.equal(second.number, first.number + 1);
      assert.deepEqual(second.initiative.rows, first.initiative.rows);
    });

    const historicalData = copy(data);
    historicalData.dealers = [
      {
        id: "D1",
        history: {
          vol2024: 100,
          vol2025: 80,
          c32024: 200,
          c32025: 220,
          yield: 2.2,
          resources2025: { MRD: 20, "SP&A": 30, "ICE Rebate": 25, Capex: 25 },
          vol2026Ytd: 999999,
          c32026Ytd: 888888,
        },
      },
      {
        id: "D2",
        history: {
          vol2024: 100,
          vol2025: 130,
          c32024: 200,
          c32025: 300,
          yield: 6,
          resources2025: { MRD: 10, "SP&A": 10, "ICE Rebate": 20, Capex: 10 },
        },
      },
    ];






    console.log("\n" + count + " engine checks passed.");
  },
  30000,
);
