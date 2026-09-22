import { test as vitestTest } from "vitest";
import assert from "node:assert/strict";
import E from "../../src/workbench/domain/engine.js";
import demoData from "../../src/workbench/domain/demo-data.json";
import fs from "node:fs";
import vm from "node:vm";

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
      "Insight 金额与对象基于当前工作稿，修改/指南/月更失效且失败保留旧记录",
      () => {
        const s = E.createState(data);
        assert.throws(() =>
          E.generateInsight(s, "MKT", { role: "lead", department: "ICE" }),
        );
        assert.throws(() => E.generateInsight(s, "global", lead));
        assert.throws(() => E.generateInsight(s, "global", management));
        E.generateInsight(s, "MKT", lead);
        assert(!E.insightIsStale(s, "MKT"));
        assert.equal(
          s.insights.MKT.items.find((i) => i.key === "concentration").object,
          "D1",
        );
        assert.match(
          s.insights.MKT.items.find((i) => i.key === "concentration").evidence,
          /120/,
        );
        E.updateInitiative(
          s,
          "M1",
          {
            rows: [
              { dealerId: "D1", amount: 0 },
              { dealerId: "D2", amount: 100 },
            ],
          },
          owner,
          data,
        );
        assert(E.insightIsStale(s, "MKT"));
        E.generateInsight(s, "MKT", lead);
        assert.equal(
          s.insights.MKT.items.find((i) => i.key === "concentration").object,
          "D2",
        );
        assert.match(
          s.insights.MKT.items.find((i) => i.key === "concentration").evidence,
          /140/,
        );
        const before = copy(s.insights.MKT);
        assert.throws(() => E.generateInsight(s, "MKT", lead, { fail: true }));
        assert.deepEqual(s.insights.MKT, before);
        E.setGuide(s, "复核资源用途", admin);
        assert(E.insightIsStale(s, "MKT"));
        E.generateInsight(s, "MKT", lead);
        E.changeReference(s, admin);
        assert(E.insightIsStale(s, "MKT"));
      },
    );
    check("全局预览展示发布快照参考，混合批次不会伪装为当前参考", () => {
      const s = E.createState(data, "submitted");
      const previous = copy(s.publications);
      const first = E.previewInsight(s, "global", management, { data });
      assert.equal(first.reference.batchId, "MOCK-REF-V1.2");
      E.changeReference(s, admin);
      const beforeRepublish = E.previewInsight(s, "global", management, {
        data,
      });
      assert.equal(beforeRepublish.reference.batchId, "MOCK-REF-V1.2");
      E.publishInitiative(s, "M1", owner, data);
      const mixed = E.previewInsight(s, "global", management, { data });
      assert.equal(mixed.reference.batchId, "MIXED-PUBLISHED-REFERENCES");
      assert.match(mixed.basisLabel, /不一致/);
      assert.deepEqual(s.publications.M2, previous.M2);
    });
    check("管理层 Insight 为只读预览，不能写入或触发定稿", () => {
      const s = E.createState(data, "submitted");
      const before = JSON.stringify(s);
      const preview = E.previewInsight(s, "global", management, { data });
      assert.equal(preview.items.length, 6);
      assert.equal(JSON.stringify(s), before);
      assert.throws(
        () => E.generateInsight(s, "global", management, { data }),
        /只读预览/,
      );
      assert.throws(() => E.finalize(s, management), /只读/);
    });
    check(
      "发布版本读权限：Owner 本人、Lead 本部门、管理层全局；管理员不读分配内容",
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
        assert.throws(() => E.latestPublication(s, "M1", admin), /无权/);
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
    check("Owner 拒绝部门分析及提示词，selector 仅有复核元数据", () => {
      const s = E.createState(data);
      E.updateInitiative(
        s,
        "M2",
        {
          rows: [{ dealerId: "D2", amount: 23.45, note: "PRIVATE-ROW-NOTE" }],
          reserve: 76.55,
          reserveNote: "PRIVATE-RESERVE-NOTE",
        },
        owner2,
        data,
      );
      E.setAnalysisPrompt(s, "MKT", "PRIVATE-PROMPT: D2 23.45", lead);
      E.setGuide(s, "PRIVATE-GUIDE-TEXT", admin);
      const record = E.generateInsight(s, "MKT", lead);
      assert.throws(() => E.generateInsight(s, "MKT", owner), /无权/);
      assert.throws(() => E.generateInsight(s, "global", owner), /管理层/);
      assert.throws(() => E.getAnalysisPrompt(s, "MKT", owner), /无权/);
      const view = E.selectView(s, owner);
      assert.deepEqual(view.insights, {});
      assert.deepEqual(view.insightStatus.MKT, {
        createdAt: record.createdAt,
        stale: false,
        promptVersion: 2,
      });
      const serialized = JSON.stringify(view);
      for (const secret of [
        "PRIVATE-ROW-NOTE",
        "PRIVATE-RESERVE-NOTE",
        "PRIVATE-PROMPT",
        "PRIVATE-GUIDE-TEXT",
        '"promptText"',
        '"guideText"',
        '"signature"',
        '"evidence"',
      ])
        assert(!serialized.includes(secret), secret);
      assert(!/(^|[^0-9])23\.45([^0-9]|$)/.test(serialized));
      assert(E.selectView(s, lead).insights.MKT.items.length === 6);
      E.setAnalysisPrompt(s, "MKT", "updated", lead);
      assert.equal(E.selectView(s, owner).insightStatus.MKT.stale, true);
    });
    check(
      "Owner 提交快照剔除部门自由文本与分析证据，保留本人行及版本元数据",
      () => {
        const s = E.createState(data);
        E.setAnalysisPrompt(s, "MKT", "PRIVATE-SNAPSHOT-PROMPT", lead);
        E.setGuide(s, "PRIVATE-SNAPSHOT-GUIDE", admin);
        E.generateInsight(s, "MKT", lead);
        E.complete(s, "M1", owner, data);
        const v = E.submit(s, "MKT", lead, data, "PRIVATE-SUBMISSION-NOTE");
        const own = E.getSnapshot(s, "MKT", v.id, owner);
        assert.deepEqual(
          own.initiatives.map((i) => i.id),
          ["M1"],
        );
        assert.equal(own.analysisBasis.promptVersion, 2);
        assert.equal(own.insightStatus.promptVersion, 2);
        assert(!own.insight);
        assert(!own.note);
        assert(!own.analysisBasis.basisToken);
        const serialized = JSON.stringify(own);
        for (const secret of [
          "PRIVATE-SNAPSHOT-PROMPT",
          "PRIVATE-SNAPSHOT-GUIDE",
          "PRIVATE-SUBMISSION-NOTE",
          '"items"',
          '"promptText"',
          '"guideText"',
          '"signature"',
          '"evidence"',
        ])
          assert(!serialized.includes(secret), secret);
        const full = E.getSnapshot(s, "MKT", v.id, lead);
        assert.equal(full.insight.promptText, "PRIVATE-SNAPSHOT-PROMPT");
        assert.equal(full.note, "PRIVATE-SUBMISSION-NOTE");
      },
    );
    check("提交明确保留生成时分析依据及过期标记，独立于提交时参考/指南", () => {
      const s = E.createState(data);
      const generated = E.generateInsight(s, "MKT", lead);
      E.setGuide(s, "新版指南", admin);
      E.changeReference(s, admin);
      E.complete(s, "M1", owner, data);
      const v = E.submit(s, "MKT", lead, data);
      assert.equal(v.guideVersion, 2);
      assert.equal(v.analysisBasis.guideVersion, 1);
      assert.equal(
        v.analysisBasis.reference.batchId,
        generated.reference.batchId,
      );
      assert.equal(v.analysisBasis.insightId, generated.id);
      assert.equal(v.analysisBasis.basisToken, generated.signature);
      assert.equal(v.analysisBasis.staleAtSubmission, true);
      const saved = copy(v.analysisBasis);
      E.changeReference(s, admin);
      E.setGuide(s, "第三版指南", admin);
      assert.deepEqual(
        E.getSnapshot(s, "MKT", v.id, management).analysisBasis,
        saved,
      );
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
      "Management selector 只取已发布版本，草稿不泄漏给管理层或管理员",
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
        assert(!JSON.stringify(adminView).includes('"rows"'));
        assert(!JSON.stringify(adminView).includes("PRIVATE-"));
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
    check("六点分析固定完整，历史缺失明确限制且不伪造预测", () => {
      const s = E.createState(data);
      const record = E.generateInsight(s, "MKT", lead);
      assert.deepEqual(
        record.items.map((i) => i.key),
        [
          "low_yield",
          "high_yield",
          "concentration",
          "overlap",
          "trend",
          "completeness",
        ],
      );
      for (const item of record.items) {
        assert(item.text && item.evidence && item.review && item.finding);
        assert(["observed", "limited", "review"].includes(item.status));
        assert.equal(item.text, item.evidence + item.review);
      }
      assert.equal(record.items[0].status, "limited");
      assert.equal(record.items[4].status, "limited");
      assert.match(record.disclaimer, /固定模板/);
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
          resource2025: 100,
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
          resource2025: 50,
          resources2025: { MRD: 10, "SP&A": 10, "ICE Rebate": 20, Capex: 10 },
        },
      },
    ];
    check(
      "部门获授权只读整体 Yield，跨部门资源明细仍不读取、趋势仅本部门",
      () => {
        const safe = copy(historicalData);
        for (const d of safe.dealers) {
          Object.defineProperty(d.history.resources2025, "ICE Rebate", {
            get() {
              throw new Error("UNAUTHORIZED_ICE_DETAIL");
            },
          });
          Object.defineProperty(d.history.resources2025, "Capex", {
            get() {
              throw new Error("UNAUTHORIZED_CAPEX_DETAIL");
            },
          });
        }
        const record = E.generateInsight(E.createState(data), "MKT", lead, {
          data: safe,
        });
        assert(record.items.slice(0, 2).every((i) => i.status === "review"));
        assert.equal(record.items[0].object, "D1");
        assert.equal(record.items[1].object, "D2");
        assert.match(record.items[0].text, /为 2.2/);
        assert.match(record.items[1].text, /为 6/);
        assert.match(record.items[0].text, /已授权只读参考/);
        assert(!JSON.stringify(record).includes("缺少整体资源授权"));
        assert.match(record.items[4].text, /Vol 同比 -20.00%/);
        assert.match(record.items[4].text, /C3 同比 10.00%/);
        assert.match(record.items[4].text, /历史资源 50/);
        assert.match(record.items[4].text, /跨两年比较，非同比/);
        assert(!JSON.stringify(record).includes("999999"));
        assert(!JSON.stringify(record).includes("888888"));
      },
    );
    check("部门 Yield 只输出授权比值，不携带总资源或范围外经销商", () => {
      const fixture = copy(historicalData);
      fixture.dealers[0].history.resource2025 = 123456.78;
      fixture.dealers[1].history.resource2025 = 234567.89;
      fixture.dealers.push({
        id: "PRIVATE-OTHER-DEALER",
        history: { c32025: 9000000, resource2025: 1 },
      });
      const s = E.createState(data);
      const record = E.generateInsight(s, "MKT", lead, { data: fixture });
      const serialized = JSON.stringify(record);
      for (const secret of [
        "123456.78",
        "123,456.78",
        "234567.89",
        "234,567.89",
        "PRIVATE-OTHER-DEALER",
        '"resource2025"',
        '"resources2025"',
      ])
        assert(!serialized.includes(secret), secret);
      assert(record.items.slice(0, 2).every((i) => i.status === "review"));
      assert.throws(
        () => E.generateInsight(s, "MKT", owner, { data: fixture }),
        /无权/,
      );
      assert.deepEqual(E.selectView(s, owner).insights, {});
    });
    check("Yield 零值、缺失、非有限分母及运算溢出不能伪造可比值", () => {
      for (const resource of [
        0,
        -1,
        null,
        undefined,
        NaN,
        Infinity,
        -Infinity,
      ]) {
        const fixture = copy(historicalData);
        fixture.dealers.forEach((d) => {
          d.history.resource2025 = resource;
        });
        const record = E.generateInsight(E.createState(data), "MKT", lead, {
          data: fixture,
        });
        assert(record.items.slice(0, 2).every((i) => i.status === "limited"));
        assert(!JSON.stringify(record).includes("Infinity"));
        assert(!JSON.stringify(record).includes("NaN"));
      }
      const fixture = copy(historicalData);
      fixture.dealers.forEach((d) => {
        d.history.c32025 = Number.MAX_VALUE;
        d.history.resource2025 = Number.MIN_VALUE;
      });
      assert(
        E.generateInsight(E.createState(data), "MKT", lead, { data: fixture })
          .items.slice(0, 2)
          .every((i) => i.status === "limited"),
      );
      fixture.dealers.forEach((d) => {
        d.history.c32025 = 0;
        d.history.resource2025 = 100;
      });
      const zero = E.generateInsight(E.createState(data), "MKT", lead, {
        data: fixture,
      });
      assert(zero.items.slice(0, 2).every((i) => i.status === "review"));
      assert.match(zero.items[0].text, /为 0/);
    });
    check(
      "全局同年 Yield 排序有证据与限制，管理层使用已提交而非后续草稿",
      () => {
        const s = E.createState(data, "submitted");
        s.initiatives[0].rows[0].amount = 7654321;
        const record = E.previewInsight(s, "global", management, {
          data: historicalData,
        });
        assert.equal(record.items[0].object, "D1");
        assert.equal(record.items[1].object, "D2");
        assert.match(record.items[0].evidence, /2.2/);
        assert.match(record.items[1].evidence, /为 6/);
        assert.match(record.items[0].text, /不能认定投入过高或不足/);
        assert.match(record.items[3].text, /3 个部门/);
        assert(!JSON.stringify(record).includes("7654321"));
      },
    );
    check("提示词权限、独立版本、旧状态兼容与负向校验", () => {
      const s = E.createState(data, "submitted");
      assert.throws(() => E.getAnalysisPrompt(s, "MKT", owner), /无权/);
      assert.equal(E.getAnalysisPrompt(s, "MKT", lead).editable, true);
      assert.equal(
        E.getAnalysisPrompt(s, "global", management).editable,
        false,
      );
      assert.throws(() => E.getAnalysisPrompt(s, "MKT", management), /无权/);
      assert.throws(() => E.getAnalysisPrompt(s, "global", owner), /管理层/);
      assert.throws(() => E.setAnalysisPrompt(s, "MKT", "x", owner), /无权/);
      assert.throws(() => E.setAnalysisPrompt(s, "ICE", "x", lead), /无权/);
      assert.throws(
        () => E.setAnalysisPrompt(s, "MKT", "x", management),
        /无权/,
      );
      assert.throws(
        () => E.setAnalysisPrompt(s, "global", " ", admin),
        /不能为空/,
      );
      assert.throws(
        () => E.setAnalysisPrompt(s, "global", "x".repeat(12001), admin),
        /12000/,
      );
      assert.throws(
        () => E.setAnalysisPrompt(s, "UNKNOWN", "x", admin),
        /部门不存在/,
      );
      const deps = copy(s.departments);
      E.generateInsight(s, "MKT", lead);
      E.generateInsight(s, "ICE", { role: "lead", department: "ICE" });
      const globalPreview = E.previewInsight(s, "global", management);
      assert.equal(globalPreview.items.length, 6);
      const updated = E.setAnalysisPrompt(s, "MKT", "  请特别核对用途  ", lead);
      assert.equal(updated.version, 2);
      assert.equal(updated.text, "请特别核对用途");
      assert(E.insightIsStale(s, "MKT"));
      assert(!E.insightIsStale(s, "ICE"));
      assert.deepEqual(s.departments, deps);
      const rec = E.generateInsight(s, "MKT", lead);
      assert.equal(rec.promptVersion, 2);
      assert.equal(rec.promptText, "请特别核对用途");
      assert.equal(rec.promptScope, "MKT");
      assert.equal(rec.items.length, 6);
      assert(!E.insightIsStale(s, "MKT"));
      assert.throws(
        () => E.setAnalysisPrompt(s, "global", "全局新依据", management),
        /无权/,
      );
      E.setAnalysisPrompt(s, "global", "全局新依据", admin);
      assert(!E.insightIsStale(s, "MKT"));
      E.setAnalysisPrompt(s, "ICE", "管理员配置", admin);
      assert.equal(E.getAnalysisPrompt(s, "ICE", admin).version, 2);
    });
    check("提示词版本绑定提交分析快照，更新配置不会重写冻结依据", () => {
      const s = E.createState(data);
      E.setAnalysisPrompt(s, "MKT", "版本二", lead);
      E.generateInsight(s, "MKT", lead);
      E.complete(s, "M1", owner, data);
      const v = E.submit(s, "MKT", lead, data);
      assert.equal(v.analysisBasis.promptVersion, 2);
      E.setAnalysisPrompt(s, "MKT", "版本三", lead);
      const old = E.getSnapshot(s, "MKT", v.id, management);
      assert.equal(old.analysisBasis.promptVersion, 2);
      assert.equal(old.insight.promptText, "版本二");
      assert(E.insightIsStale(s, "MKT"));
    });

    check("旧持久化 Insight 在分析口径升级后待更新，提交快照保持原值", () => {
      // Emulate the prior engine signature, which omitted the analysis-basis version.

      const source = fs.readFileSync(
        new URL("../../src/workbench/domain/engine.js", import.meta.url),
        "utf8",
      );
      const legacySource = source.replace(
        /\s*analysisBasisVersion: ANALYSIS_BASIS_VERSION,/,
        "",
      );
      assert.notEqual(source, legacySource);
      const sandbox = { module: { exports: {} } };
      vm.runInNewContext(
        legacySource.replace("export default", "module.exports ="),
        sandbox,
      );
      const oldEngine = sandbox.module.exports;
      const oldState = oldEngine.createState(data);
      oldEngine.generateInsight(oldState, "MKT", lead);
      oldEngine.complete(oldState, "M1", owner, data);
      oldEngine.submit(oldState, "MKT", lead, data, "历史提交");
      const restored = copy(oldState);
      const frozen = copy(restored.departments.MKT.versions);
      assert(E.insightIsStale(restored, "MKT"));
      assert.equal(E.selectView(restored, lead).insights.MKT.stale, true);
      assert.equal(E.selectView(restored, owner).insightStatus.MKT.stale, true);
      const fresh = E.generateInsight(restored, "MKT", lead, {
        data: historicalData,
      });
      assert.match(
        fresh.analysisMethodVersion,
        /latest-publication-owner-scope/,
      );
      assert(fresh.items.slice(0, 2).every((item) => item.status === "review"));
      assert(!E.insightIsStale(restored, "MKT"));
      assert.deepEqual(restored.departments.MKT.versions, frozen);
    });

    console.log("\n" + count + " engine checks passed.");
  },
  30000,
);
