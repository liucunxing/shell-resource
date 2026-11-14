import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import WorkbenchApp from "../src/workbench/WorkbenchApp.jsx";

const shared = vi.hoisted(() => ({ context: {} }));
vi.mock("../src/workbench/WorkbenchContext.jsx", () => ({
  useWorkbench: () => shared.context,
}));
vi.mock("../src/workbench/localPreview", () => ({
  getLocalPreviewConfig: () => ({ defaultEmail: "owner-a@example.test" }),
}));

beforeEach(() => {
  shared.context = {
    identity: null,
    state: {},
    apiMode: true,
    loading: true,
    refresh: vi.fn(),
  };
});

it("keeps the synthetic local entry free of Portal login instructions while bootstrap is pending", () => {
  const html = renderToStaticMarkup(<WorkbenchApp />);
  expect(html).toContain("正在加载本地测试工作台");
  expect(html).not.toContain("登录资源投资工作台");
  expect(html).not.toContain("帆软");
});

it("keeps a retry action and the actual error if local bootstrap fails", () => {
  shared.context.loading = false;
  shared.context.storageWarning = "本地测试服务不可用";
  const html = renderToStaticMarkup(<WorkbenchApp />);
  expect(html).toContain('role="alert"');
  expect(html).toContain("本地测试服务不可用");
  expect(html).toContain("重新加载");
  expect(html).not.toContain("登录资源投资工作台");
});
