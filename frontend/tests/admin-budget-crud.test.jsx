import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import E from "../src/workbench/domain/engine.js";
import data from "../src/workbench/domain/demo-data.json";
import {
  AdminBudgetFields,
  budgetForm,
  budgetPayload,
} from "../src/workbench/pages/AdminBudgetFields.jsx";

const admin = { role: "admin", apiMode: true };
const users = [{ email: "owner@example.com", department: ["MKT", "ICE"], role: "lead" }];

it("uses the same six fields for create and edit and normalizes email and resource values", () => {
  const form = {
    ...budgetForm(),
    name: " Test ",
    resourceType: "capex",
    ownerId: " OWNER@EXAMPLE.COM ",
    budget: "12.50",
  };
  expect(budgetPayload(form, true)).toMatchObject({
    name: "Test",
    ownerId: "owner@example.com",
    resourceType: "Capex",
    budget: 12.5,
  });
  expect(() => budgetPayload({ ...form, budget: "" }, true)).toThrow(
    "预算不能为空",
  );
  const html = renderToStaticMarkup(
    <AdminBudgetFields
      value={form}
      onChange={() => {}}
      users={users}
      apiMode
    />,
  );
  for (const label of [
    "Initiative 名称",
    "Sector",
    "资源类型",
    "部门",
    "Owner 邮箱",
    "预算金额",
  ])
    expect(html).toContain(label);
});

it("validates full edits, preserves allocations, and supports explicit deletion", () => {
  const state = E.createState(data, "working");
  const current = state.initiatives[0];
  const rows = structuredClone(current.rows);
  const form = {
    name: "Renamed",
    sector: "B2B",
    resourceType: "Capex",
    department: "ICE",
    ownerId: "owner@example.com",
    budget: 100,
  };
  expect(() =>
    E.editAdminBudget(
      state,
      current.id,
      { ...form, ownerId: "other@x.com" },
      admin,
      users,
    ),
  ).toThrow("Owner");
  const revision = current.revision;
  E.editAdminBudget(state, current.id, form, admin, users);
  expect(current).toMatchObject(form);
  expect(current.rows).toEqual(rows);
  expect(current.revision).toBe(revision + 1);
  E.deleteAdminBudget(state, current.id, admin);
  expect(state.initiatives.some((item) => item.id === current.id)).toBe(false);
  expect(state.publications[current.id]).toBeUndefined();
  expect(state.audit.at(-1).action).toBe("delete_admin_budget");
});
