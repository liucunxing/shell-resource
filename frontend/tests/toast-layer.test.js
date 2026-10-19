import { expect, it } from "vitest";
import { toastHost } from "../src/workbench/ToastNotice.jsx";

it("hosts messages in the topmost modal instead of behind its native backdrop", () => {
  const body = {};
  const first = {};
  const last = {};
  expect(toastHost({ body, querySelectorAll: () => [] })).toBe(body);
  expect(toastHost({ body, querySelectorAll: () => [first, last] })).toBe(last);
});
