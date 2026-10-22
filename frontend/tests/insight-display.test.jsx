import { describe, expect, it } from "vitest";
import { formatEvidence, formatInsightCopy } from "../src/workbench/pages/InsightCapabilityResult";

describe("Insight display precision", () => {
  it("uses 万元 for money, including zero, negative amounts and cents", () => {
    expect(formatEvidence(100000, "CNY")).toBe("10 万元");
    expect(formatEvidence(-70000, "CNY")).toBe("-7 万元");
    expect(formatEvidence(0.01, "CNY")).toBe("0 万元");
    expect(formatEvidence(350139.82, "CNY")).toBe("35.01 万元");
    expect(formatEvidence(-3706901.08, "CNY")).toBe("-370.69 万元");
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
    const saved = "深圳市海之润润滑材料有限公司（12090378）2025全年实际投入35.013982万元，2027计划投入405.70409万元，增加370.690108万元。";
    const rounded = "深圳市海之润润滑材料有限公司（12090378）2025全年实际投入35.01万元，2027计划投入405.7万元，增加370.69万元。";
    expect(formatInsightCopy(saved)).toBe(rounded);
    expect(formatInsightCopy(rounded)).toBe(rounded);
    const metrics = "同比12.34567%，销量821.37019 KL，资源69.70726 K$，计划/实际2.34567倍，历史Yield为5.59倍；2027年，编码12090378，版本0.3.4。";
    const display = "同比12.35%，销量821.37 KL，资源69.71 K$，计划/实际2.35倍，历史Yield为5.6倍；2027年，编码12090378，版本0.3.4。";
    expect(formatInsightCopy(metrics)).toBe(display);
    expect(formatInsightCopy(display)).toBe(display);
  });
});
