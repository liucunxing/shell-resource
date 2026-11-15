import { describe, expect, it } from "vitest";
import { initiativePayload } from "../src/workbench/pages/AdminStudioPage.jsx";
const row = {
  id: 1,
  name: "测试项目",
  sector: "PCMO",
  department: "MKT",
  resourceType: "MRD",
  ownerId: "owner@example.test",
  budget: "123456",
  enabled: true,
  reason: "调整预算",
};
describe("V19 inline configuration currency and validation", () => {
  it("identifies the project and missing field so the editor can focus it", () => {
    try {
      initiativePayload({ ...row, reason: "" });
    } catch (error) {
      expect(error.message).toContain("测试项目");
      expect(error.message).toContain("变化原因");
      expect(error.field).toBe("reason");
      return;
    }
    throw new Error("Missing reason was accepted");
  });
  it("submits integer yuan unchanged rather than converting from wan", () => {
    expect(initiativePayload(row).budget).toBe(123456);
  });
  it("accepts an explicit zero budget and preserves disabled state", () => {
    expect(
      initiativePayload({ ...row, budget: 0, enabled: false }),
    ).toMatchObject({ budget: 0, enabled: false });
  });
  it.each([
    { budget: "12.5" },
    { budget: -1 },
    { budget: "invalid" },
    { budget: "" },
    { budget: null },
    { reason: " " },
    { ownerId: " " },
    { name: " " },
  ])("rejects invalid changes before any request", (patch) => {
    expect(() => initiativePayload({ ...row, ...patch })).toThrow();
  });
});
