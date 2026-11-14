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
    { reason: " " },
    { ownerId: " " },
    { name: " " },
  ])("rejects invalid changes before any request", (patch) => {
    expect(() => initiativePayload({ ...row, ...patch })).toThrow();
  });
});
