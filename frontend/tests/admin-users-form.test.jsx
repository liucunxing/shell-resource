import { describe, expect, it } from "vitest";
import {
  departmentAfterRoleChange,
  userDepartmentOptions,
} from "../src/workbench/pages/AdminUsersPanel.jsx";

describe("管理员人员部门选择", () => {
  it("默认 MKT 时仍提供全部三个部门", () => {
    expect(userDepartmentOptions("MKT")).toEqual(["MKT", "ICE", "CAPEX"]);
  });

  it("切换管理员再切回 Owner 时恢复可选部门", () => {
    const previous = departmentAfterRoleChange("admin", "ICE");
    expect(departmentAfterRoleChange("owner", previous)).toBe("ICE");
    expect(departmentAfterRoleChange("owner", "")).toBe("MKT");
    expect(userDepartmentOptions("MKT")).toHaveLength(3);
  });
});
