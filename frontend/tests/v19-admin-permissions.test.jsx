import { describe, expect, it } from "vitest";
import { historyPermissionPayload } from "../src/workbench/pages/HistoricalResourceSettings.jsx";
import { initiativesForUser } from "../src/workbench/pages/AdminUsersPanel.jsx";

const user = { id: 1, email: "owner@example.test", display_name: "Owner", role: "owner", department: ["MKT", "ICE"], sector: ["PCMO"], enabled: false, affiliation_sector: "B2B", affiliation_department: "MKT", history_resources: ["MRD"], has_initiatives: true };

describe("V19 user permissions preserve actual account fields", () => {
  it("changes only the requested override and keeps unrelated business scope and status", () => {
    expect(historyPermissionPayload(user, ["Capex"])).toEqual({ email: user.email, display_name: "Owner", role: "owner", department: ["MKT", "ICE"], sector: ["PCMO"], enabled: false, affiliation_sector: "B2B", affiliation_department: "MKT", history_resources: ["Capex"] });
  });
  it("distinguishes inheriting permissions from explicitly granting no expense columns", () => {
    expect(historyPermissionPayload(user, null).history_resources).toBeNull();
    expect(historyPermissionPayload(user, []).history_resources).toEqual([]);
  });
  it("does not derive missing affiliation from business scope", () => {
    expect(() => historyPermissionPayload({ ...user, affiliation_sector: null }, [])).toThrow("真实所属部门");
  });
  it("shows only the user's actual current-version initiatives, including stable cancelled records", () => {
    const items = [{ id: "1", name: "A", ownerId: "OWNER@EXAMPLE.TEST" }, { id: "2", name: "B", ownerId: "other@example.test" }, { id: "3", name: "C", ownerId: user.email, enabled: false }];
    expect(initiativesForUser(user, items).map((item) => item.name)).toEqual(["A", "C"]);
    expect(initiativesForUser(user)).toEqual([]);
  });
});
