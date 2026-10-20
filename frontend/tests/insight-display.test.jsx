import { describe, expect, it } from "vitest";
import { formatEvidence, formatInsightCopy } from "../src/workbench/pages/InsightCapabilityResult";

describe("Insight display precision", () => {
  it("uses 万元 for money, including zero, negative amounts and cents", () => {
    expect(formatEvidence(100000, "CNY")).toBe("10 万元");
    expect(formatEvidence(-70000, "CNY")).toBe("-7 万元");
    expect(formatEvidence(0.01, "CNY")).toBe("0.000001 万元");
    expect(formatEvidence(null, "CNY")).toBe("缺失");
    expect(formatEvidence(0, "CNY")).toBe("0 万元");
  });
  it("keeps one decimal for Yield without modifying source numbers", () => {
    expect(formatEvidence(2.345, "multiple")).toBe("2.3 倍");
    expect(formatEvidence(2, "multiple")).toBe("2.0 倍");
    expect(formatEvidence(2.349, "multiple")).toBe("2.3 倍");
  });
  it("formats saved older prose and never scales 万元 twice", () => {
    const original = "2025实际100,000元，2027计划1,000,000元，增加900,000元；历史Yield为2.345倍。";
    const expected = "2025实际10万元，2027计划100万元，增加90万元；历史Yield为2.3倍。";
    expect(formatInsightCopy(original)).toBe(expected);
    expect(formatInsightCopy(expected)).toBe(expected);
    expect(original).toContain("100,000元");
  });
});
