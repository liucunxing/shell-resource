import { expect, it } from "vitest";
import { donutTooltipPosition } from "../src/workbench/pages/donut-tooltip-position";

it("follows the pointer and keeps the tooltip inside the viewport", () => {
  const tip = { width: 160, height: 30 };
  const viewport = { width: 400, height: 300 };
  expect(donutTooltipPosition({ x: 100, y: 60 }, tip, viewport)).toEqual({ left: 112, top: 72 });
  expect(donutTooltipPosition({ x: 100, y: 200 }, tip, viewport)).toEqual({ left: 112, top: 212 });
  expect(donutTooltipPosition({ x: 395, y: 295 }, tip, viewport)).toEqual({ left: 232, top: 262 });
});
