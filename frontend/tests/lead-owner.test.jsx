import { expect, it } from "vitest";
import E from "../src/workbench/domain/engine.js";
import AX from "../src/workbench/domain/admin-excel.js";
import EX from "../src/workbench/domain/excel.js";
import data from "../src/workbench/domain/demo-data.json";

it("allows a Lead to allocate and import only initiatives assigned to them", async () => {
  const state = E.createState(data, "working");
  const item = state.initiatives.find(i => i.department === "ICE");
  const lead = { role: "lead", apiMode: true, department: ["MKT", "ICE"], ownerId: "lead@example.test" };
  item.ownerId = lead.ownerId;
  expect(E.canEdit(state, item.id, lead)).toBe(true);
  const bytes = await EX.exportWorkbook(state, item.id, lead, data);
  const preview = await EX.previewImport(bytes, state, item.id, lead, data);
  expect(preview.errors).toEqual([]);
  expect(E.canEdit(state, item.id, { ...lead, department: ["MKT"] })).toBe(false);
  expect(E.canEdit(state, item.id, { ...lead, ownerId: "other@example.test" })).toBe(false);
  await expect(EX.exportWorkbook(state, item.id, { ...lead, ownerId: "other@example.test" }, data)).rejects.toThrow();
});
it("accepts a department Lead as Owner in admin Excel import", async () => {
  const state = E.createState(data, "working");
  state.initiatives = state.initiatives.filter(i => i.department === "ICE");
  state.initiatives.forEach(i => { i.ownerId = "lead@example.test"; });
  const admin = { role: "admin", apiMode: true };
  const bytes = await AX.exportWorkbook(state, admin);
  const users = [{ role: "lead", department: ["MKT", "ICE"], email: "lead@example.test" }];
  expect((await AX.previewImport(bytes, state, admin, users)).errors).toEqual([]);
  expect((await AX.previewImport(bytes, state, admin, [{ ...users[0], department: ["MKT"] }])).errors.length).toBeGreaterThan(0);
});
