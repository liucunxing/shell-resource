import { describe, expect, it } from "vitest";
import { formatMoneyInput } from "../src/workbench/pages/MoneyInput.jsx";

describe("money input formatting", () => {
  it("groups integer digits without changing decimals or incomplete input", () => {
    expect(formatMoneyInput(20000)).toBe("20,000");
    expect(formatMoneyInput("1234567.50")).toBe("1,234,567.50");
    expect(formatMoneyInput("1000.")).toBe("1,000.");
    expect(formatMoneyInput("")).toBe("");
    expect(formatMoneyInput("12x")).toBe("12x");
  });
});
