import { describe, expect, it, vi } from "vitest";
import { Input } from "../src/components/ui/input";
import { formatMoneyInput, sanitizeMoneyInput } from "../src/workbench/pages/MoneyInput.jsx";

describe("money input formatting", () => {
  it("groups integer digits without changing decimals or incomplete input", () => {
    expect(formatMoneyInput(20000)).toBe("20,000");
    expect(formatMoneyInput("1234567.50")).toBe("1,234,567.50");
    expect(formatMoneyInput("1000.")).toBe("1,000.");
    expect(formatMoneyInput("")).toBe("");
    expect(formatMoneyInput("12x")).toBe("12x");
  });
});


describe("numeric amount input", () => {
  it("removes letters and Chinese input while preserving digits and one decimal point", () => {
    expect(sanitizeMoneyInput("1,000的")).toBe("1000");
    expect(sanitizeMoneyInput("12.3a.45")).toBe("12.345");
    expect(sanitizeMoneyInput("中文")).toBe("");
  });
});


describe("numeric configuration inputs", () => {
  it("blocks exponent and sign keys and invalid paste while retaining decimal input", () => {
    const input = Input({ type: "number" });
    const preventDefault = vi.fn();
    input.props.onKeyDown({ key: "e", preventDefault });
    input.props.onKeyDown({ key: "-", preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(2);
    input.props.onKeyDown({ key: ".", preventDefault });
    input.props.onPaste({ clipboardData: { getData: () => "7.2" }, preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(2);
    input.props.onPaste({ clipboardData: { getData: () => "1e3" }, preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(3);
  });
});
