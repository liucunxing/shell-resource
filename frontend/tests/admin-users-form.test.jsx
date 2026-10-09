import { describe, expect, it } from "vitest";
import {
  departmentAfterRoleChange,
  sectorAfterRoleChange,
  toggleSectorSelection,
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

describe("管理员人员业务线选择", () => {
  it("切换为 Owner 时只保留第一条业务线，切换为管理员时清空", () => {
    expect(sectorAfterRoleChange("owner", ["PCMO", "CRTO"])).toEqual(["PCMO"]);
    expect(sectorAfterRoleChange("admin", ["PCMO"])).toEqual([]);
  });

  it("部门负责人保留全部已选业务线", () => {
    expect(sectorAfterRoleChange("lead", ["PCMO", "CRTO", "B2B", "OEM"])).toEqual([
      "PCMO", "CRTO", "B2B", "OEM",
    ]);
  });

  it("Owner 点击业务线会直接切换为单选，负责人可切换多选", () => {
    expect(toggleSectorSelection("owner", ["PCMO"], "CRTO")).toEqual(["CRTO"]);
    expect(toggleSectorSelection("lead", ["PCMO"], "CRTO")).toEqual(["PCMO", "CRTO"]);
    expect(toggleSectorSelection("lead", ["PCMO", "CRTO"], "PCMO")).toEqual(["CRTO"]);
  });
});
