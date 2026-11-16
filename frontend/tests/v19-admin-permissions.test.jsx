import { describe, expect, it } from "vitest";
import { departmentExpenseFields, departmentExpenseLimit } from "../src/workbench/pages/HistoricalResourceSettings.jsx";
import { initiativesForUser } from "../src/workbench/pages/AdminUsersPanel.jsx";

const user = { id: 1, email: "owner@example.test", display_name: "Owner", role: "owner", department: ["MKT", "ICE"], sector: ["PCMO"], enabled: false, affiliation_sector: "B2B", affiliation_department: "MKT", history_resources: ["MRD"], has_initiatives: true };

describe("V19 user permissions preserve actual account fields", () => {
  it("bounds history permissions to the affiliated department", () => {
    expect(departmentExpenseLimit("B2B|Capex")).toEqual(["Capex"]);
    expect(departmentExpenseLimit(null)).toEqual([]);
    expect(departmentExpenseFields({ "B2B|MKT": ["MRD", "Capex"] }, "B2B", "MKT")).toEqual(["MRD"]);
    expect(departmentExpenseFields({}, "B2B", "MKT")).toEqual(["MRD", "SP&A"]);
  });
  it("shows only the user's actual current-version initiatives, including stable cancelled records", () => {
    const items = [{ id: "1", name: "A", ownerId: "OWNER@EXAMPLE.TEST" }, { id: "2", name: "B", ownerId: "other@example.test" }, { id: "3", name: "C", ownerId: user.email, enabled: false }];
    expect(initiativesForUser(user, items).map((item) => item.name)).toEqual(["A", "C"]);
    expect(initiativesForUser(user)).toEqual([]);
  });
});
