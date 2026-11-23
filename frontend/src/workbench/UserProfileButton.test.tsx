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
    ["management", "业务线范围未配置"],
    ["lead", "部门范围未配置"],
  ])("shows the %s scope without inventing an affiliation", (role, scope) => {
    const fields = Object.fromEntries(profileFields({ role }));
    expect(fields["授权范围"]).toBe(scope);
    expect(fields["所属部门"]).toBe("-");
    expect(fields).not.toHaveProperty("用户 ID");
  });
  it("reads account departments when home affiliation is missing", () => {
    expect(Object.fromEntries(profileFields({ role: "owner", department: ["ICE"] }))["所属部门"]).toBe("ICE");
    expect(Object.fromEntries(profileFields({
      role: "lead", sectors: ["PCMO", "OEM"], department: ["MKT", "", "ICE", "MKT"],
    }))["所属部门"]).toBe("MKT、ICE");
    expect(Object.fromEntries(profileFields({
      role: "admin", affiliation_department: "CAPEX",
    }))["所属部门"]).toBe("CAPEX");
  });
  it("shows configured contacts, escapes account text and preserves missing states", () => {
    const missing = renderToStaticMarkup(
      <UserProfileDetails identity={{ role: "owner" }} />,
    );
    expect(missing).toContain('class="user-profile-empty-department"><dt>所属部门</dt><dd>-</dd>');
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


it("shows explicit management grants even when home affiliation differs", () => {
  const fields = Object.fromEntries(profileFields({ role: "management", sectors: ["PCMO", "OEM"], affiliation_sector: "B2B", affiliation_department: "ICE" }));
  expect(fields["授权范围"]).toBe("PCMO、OEM / 全部部门");
  expect(fields["所属部门"]).toBe("B2B / ICE");
});
