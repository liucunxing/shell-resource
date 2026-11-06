import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import E from "../src/workbench/domain/engine.js";
import D from "../src/workbench/domain/demo-data.json";
import { UserPreviewBanner } from "../src/workbench/UserPreviewBanner";
import { EditorPage } from "../src/workbench/pages/EditorPage.jsx";
import { InsightPanel } from "../src/workbench/pages/InsightPanel.jsx";
import { WorkPanel } from "../src/workbench/WorkPanel.jsx";
import WorkbenchApp from "../src/workbench/WorkbenchApp.jsx";
import { AdminUsersPanel } from "../src/workbench/pages/AdminUsersPanel.jsx";
import { HistoricalResourceSettings } from "../src/workbench/pages/HistoricalResourceSettings.jsx";

const shared = vi.hoisted(() => ({ context: null }));
vi.mock("../src/workbench/WorkbenchContext.jsx", () => ({ useWorkbench: () => shared.context }));

beforeEach(() => {
  const state = E.createState(D, "working");
  const item = state.initiatives[0];
  const identity = { role: "owner", key: "owner", email: "owner@example.test", ownerId: item.ownerId,
    department: [item.department], preview: { readOnly: true, actorEmail: "admin@example.test" } };
  shared.context = { state, identity, data: D, view: E.selectView(state, identity), apiMode: true,
    previewMode: true, previewActor: { email: "admin@example.test" },
    initiativeId: item.id, dirtyIds: new Set(), savedForSyncIds: new Set(),
    editorOperations: {}, directoryStatus: {}, notify: vi.fn(), loadDistributorDirectory: vi.fn(),
    auxiliary: { open: true, tab: "chat" } };
});

describe("user preview read-only surfaces", () => {
  it("identifies the selected user and exposes an explicit administrator return action", () => {
    const html = renderToStaticMarkup(<UserPreviewBanner identity={shared.context.identity}
      actor={shared.context.previewActor} busy={false} onExit={vi.fn()} />);
    expect(html).toContain("owner@example.test");
    expect(html).toContain("admin@example.test");
    expect(html).toContain("只读模式");
    expect(html).toContain("返回管理员");
  });

  it("prevents owner allocation editing, template import, saving, and synchronization", () => {
    expect(E.canEdit(shared.context.state, shared.context.initiativeId, shared.context.identity)).toBe(false);
    const html = renderToStaticMarkup(<EditorPage />);
    expect(html).not.toContain(">保存草稿<");
    expect(html).not.toContain(">同步最新分配<");
    expect(html).not.toContain(">按比例分配<");
    expect(html).not.toContain('type="file"');
  });

  it("keeps Insight visible but disables generation", () => {
    const html = renderToStaticMarkup(<InsightPanel />);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>生成分析<\/button>/);
  });

  it("never mounts a Data Agent frame during a user preview", () => {
    const html = renderToStaticMarkup(<WorkPanel overlay={false} />);
    expect(html).toContain("模拟查看期间暂停问数");
    expect(html).not.toContain('title="Data Agent 问数界面"');
    expect(html).not.toContain("正在打开 Data Agent");
    expect(html).not.toContain("embedded-ask");
  });

  it("keeps a return path after a simulated user's refresh fails", () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }), innerWidth: 1440 });
    vi.stubGlobal("document", { documentElement: { clientWidth: 1440 } });
    shared.context.identity = null;
    shared.context.storageWarning = "用户权限已变更";
    const html = renderToStaticMarkup(<WorkbenchApp />);
    expect(html).toContain("返回管理员");
    expect(html).toContain("用户权限已变更");
    expect(html).not.toContain("登录资源投资工作台");
    vi.unstubAllGlobals();
  });

  it("disables account creation and permission changes for a simulated administrator", () => {
    shared.context.identity.role = "admin";
    const users = renderToStaticMarkup(<AdminUsersPanel />);
    expect(users).toMatch(/<button[^>]*disabled=""[^>]*>新增人员<\/button>/);
    const settings = renderToStaticMarkup(<HistoricalResourceSettings mapping={{ MKT: ["MRD"] }}
      departments={["MKT"]} saveConfig={vi.fn()} readOnly />);
    expect(settings).toMatch(/<input[^>]*disabled=""/);
    expect(settings).toMatch(/<button[^>]*disabled=""[^>]*>保存资源列权限<\/button>/);
    const insight = renderToStaticMarkup(<InsightPanel />);
    expect(insight).toMatch(/<select aria-label="模拟用户视角" disabled=""/);
    expect(insight).toMatch(/<button[^>]*disabled=""[^>]*>试用分析<\/button>/);
  });
});
