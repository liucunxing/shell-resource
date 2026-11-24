import { expect, it } from "vitest";
import { filterManagementItems } from "../src/workbench/domain/management-filters.js";
import { resolveManagementFilters } from "../src/workbench/pages/ManagementFilters.jsx";

const items = [
  { id: "1", initiativeKey: "a", name: "同名项目", sector: "PCMO", department: "MKT", resourceType: "MRD" },
  { id: "2", initiativeKey: "b", name: "同名项目", sector: "B2B", department: "ICE", resourceType: "SP&A" },
  { id: "3", initiativeKey: "c", name: "项目 C", sector: "CRTO", department: "MKT", resourceType: "MRD" },
  { id: "4", initiativeKey: "d", name: "项目 D", sector: "PCMO", department: "Capex", resourceType: "Capex" },
  { id: "5", initiativeKey: "e", name: "项目 E", sector: "B2B", department: "MKT", resourceType: "Capex" },
  { id: "6", initiativeKey: "f", name: "项目 F", sector: "B2B", department: "MKT", resourceType: "MRD" },
  { id: "7", initiativeKey: "g", name: "项目 G", sector: "B2B", department: "ICE", resourceType: "ICE Rebate" },
  { id: "8", initiativeKey: "h", name: "项目 H", sector: "PCMO", department: "ICE", resourceType: "ICE Rebate" },
];
const options = (state, key) => state.fields.find((field) => field.key === key).options;
const values = (state, key) => options(state, key).map((option) => option.value);

it("combines selections with OR within each filter and AND across filters", () => {
  expect(filterManagementItems(items, {
    sector: ["PCMO", "B2B"],
    department: ["MKT", "ICE"],
    resourceType: ["MRD", "SP&A"],
    initiative: ["a", "b", "c", "d", "e"],
  }).map((item) => item.id)).toEqual(["1", "2"]);
  expect(filterManagementItems(items, { sector: [], initiative: [] })).toBe(items);
});

it("keeps sectors and departments independent and narrows the resource and Initiative menus", () => {
  const scoped = resolveManagementFilters(items, { sector: ["B2B", "PCMO"], department: ["ICE"] });
  expect(values(scoped, "sector")).toEqual(["B2B", "CRTO", "PCMO"]);
  expect(values(scoped, "department")).toEqual(["Capex", "ICE", "MKT"]);
  expect(values(scoped, "resourceType")).toEqual(["ICE Rebate"]);
  expect(values(scoped, "initiative").sort()).toEqual(["b", "g", "h"]);
  expect(scoped.scopedItems.map(({ id }) => id)).toEqual(["2", "7", "8"]);

  const filtered = resolveManagementFilters(items, {
    sector: ["B2B"],
    department: ["ICE"],
    resourceType: ["ICE Rebate"],
  });
  expect(values(filtered, "initiative")).toEqual(["g"]);
  expect(filtered.scopedItems.map(({ id }) => id)).toEqual(["7"]);
});

it("clears unavailable downstream selections before evaluating the next filter", () => {
  const scoped = resolveManagementFilters(items, {
    sector: ["B2B"],
    department: ["ICE"],
    resourceType: ["Capex", "MRD"],
    initiative: ["a", "g"],
  });
  expect(scoped.filters).toEqual({ sector: ["B2B"], department: ["ICE"], resourceType: [], initiative: ["g"] });
  expect(values(scoped, "initiative").sort()).toEqual(["b", "g"]);
  expect(scoped.scopedItems.map(({ id }) => id)).toEqual(["7"]);
});

it("allows a sector and department combination with no projects", () => {
  const selections = { sector: ["CRTO"], department: ["ICE"] };
  const empty = resolveManagementFilters(items, selections);
  expect(empty.filters).toBe(selections);
  expect(values(empty, "resourceType")).toEqual([]);
  expect(values(empty, "initiative")).toEqual([]);
  expect(empty.scopedItems).toEqual([]);

  const restored = resolveManagementFilters(items, { ...empty.filters, department: [] });
  expect(values(restored, "resourceType")).toEqual(["MRD"]);
  expect(values(restored, "initiative")).toEqual(["c"]);
});

it("keeps same-name Initiatives distinct and retains valid selections when a version changes", () => {
  const previous = resolveManagementFilters(items.slice(0, 2));
  expect(values(previous, "initiative"))
    .toEqual(["a", "b"]);
  expect(options(previous, "initiative").map(({ scope }) => scope))
    .toEqual(["PCMO / MKT", "B2B / ICE"]);

  const current = resolveManagementFilters([{ ...items[1], id: "20" }, items[6]], {
    sector: ["PCMO"],
    department: ["ICE"],
    resourceType: ["MRD"],
    initiative: ["b", "c"],
  });
  expect(current.filters).toEqual({ sector: [], department: ["ICE"], resourceType: [], initiative: ["b"] });
  expect(current.scopedItems.map(({ id }) => id)).toEqual(["20"]);
});
