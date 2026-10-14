import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PortalLogin } from "../src/workbench/WorkbenchApp.jsx";

describe("Portal-only login screen", () => {
  it("does not render an editable email field or a manual login action", () => {
    const html = renderToStaticMarkup(<PortalLogin email="portal@example.com" loading={false} onSubmit={() => {}} error="" />);
    expect(html).toContain("portal@example.com");
    expect(html).toContain("邮箱由帆软 Portal 自动传入，不能手工修改。");
    expect(html).toMatch(/<input[^>]*readonly/);
    expect(html).toContain("进入工作台");
  });
});
