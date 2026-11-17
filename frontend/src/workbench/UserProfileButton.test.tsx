import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  profileFields,
  UserProfileButton,
  UserProfileDetails,
} from "./UserProfileButton";

describe("V20 user profile", () => {
  it("keeps business authorization separate from home department", () => {
    const fields = Object.fromEntries(
      profileFields({
        userId: "17",
        email: "lead@example.test",
        label: "Lead",
        role: "lead",
        department: ["MKT", "ICE"],
        sectors: ["PCMO", "CVL"],
        affiliation_sector: "PCMO",
        affiliation_department: "MKT",
      }),
    );
    expect(fields).not.toHaveProperty("用户 ID");
    expect(fields["授权范围"]).toBe(
      "PCMO / MKT、PCMO / ICE、CVL / MKT、CVL / ICE",
    );
    expect(fields["所属部门"]).toBe("PCMO / MKT");
    expect(fields["拥有角色"]).toBe("部门负责人");
  });
  it.each([
    ["owner", "本人负责的 Initiative"],
    ["admin", "系统配置"],
    ["management", "全部 Sector / 部门"],
    ["lead", "部门范围未配置"],
  ])("shows the %s scope without inventing an affiliation", (role, scope) => {
    const fields = Object.fromEntries(profileFields({ role }));
    expect(fields["授权范围"]).toBe(scope);
    expect(fields["所属部门"]).toBe("未配置 · 历史费用明细不可见");
    expect(fields).not.toHaveProperty("用户 ID");
  });
  it("shows configured contacts, escapes account text and preserves missing states", () => {
    const missing = renderToStaticMarkup(
      <UserProfileDetails identity={{ role: "owner" }} />,
    );
    expect(missing).toContain("管理员联系方式尚未配置");
    const rendered = renderToStaticMarkup(
      <UserProfileDetails
        identity={{
          role: "owner",
          adminContacts: [{ name: "<Admin>", email: "admin@example.test" }],
        }}
      />,
    );
    expect(rendered).toContain("&lt;Admin&gt;（admin@example.test）");
  });
  it("exposes an accessible dialog trigger rather than a static avatar", () => {
    const rendered = renderToStaticMarkup(
      <UserProfileButton identity={{ role: "owner", label: "测试" }} />,
    );
    expect(rendered).toContain('aria-haspopup="dialog"');
    expect(rendered).toContain(
      'aria-label="测试，Initiative Owner，查看个人信息"',
    );
  });
});
