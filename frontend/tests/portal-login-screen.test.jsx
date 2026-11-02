import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PortalLogin } from "../src/workbench/WorkbenchApp.jsx";

describe("Portal-only login screen", () => {
  it("does not render an editable email field or a manual login action", () => {
    const html = renderToStaticMarkup(<PortalLogin email="portal@example.com" loading={false} onSubmit={() => {}} error="" editable={false} />);
    expect(html).toContain("portal@example.com");
    expect(html).toContain("邮箱由帆软 Portal 自动传入，不能手工修改。");
    expect(html).toMatch(/<input[^>]*readonly/);
    expect(html).toContain("进入工作台");
  });

  it("permits manual email entry when enabled for testing", () => {
    const html = renderToStaticMarkup(<PortalLogin email="portal@example.com" loading={false} onSubmit={() => {}} error="" editable />);
    expect(html).toContain("portal@example.com");
    expect(html).not.toMatch(/<input[^>]*readonly=""/);
    expect(html).toContain('aria-readonly="false"');
    expect(html).toContain("请输入工作邮箱");
    expect(html).toContain("仅限已获授权的内部用户使用。");
  });

  it("prevents editing and repeat submission while checking permissions", () => {
    const html = renderToStaticMarkup(<PortalLogin email="portal@example.com" loading onSubmit={() => {}} error="" editable />);
    expect(html).toMatch(/<input[^>]*disabled/);
    expect(html).toMatch(/<button[^>]*disabled/);
  });
});
