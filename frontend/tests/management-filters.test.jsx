import { expect, it } from "vitest";
import { filterManagementItems, retainAvailableManagementFilters } from "../src/workbench/domain/management-filters.js";
import { managementFilterFields } from "../src/workbench/pages/ManagementFilters.jsx";

const items = [
  { id: "1", initiativeKey: "a", name: "同名项目", sector: "PCMO", department: "MKT", resourceType: "MRD" },
  { id: "2", initiativeKey: "b", name: "同名项目", sector: "B2B", department: "ICE", resourceType: "SP&A" },
  { id: "3", initiativeKey: "c", name: "项目 C", sector: "CRTO", department: "MKT", resourceType: "MRD" },
  { id: "4", initiativeKey: "d", name: "项目 D", sector: "PCMO", department: "Capex", resourceType: "Capex" },
  { id: "5", initiativeKey: "e", name: "项目 E", sector: "B2B", department: "MKT", resourceType: "Capex" },
  { id: "6", initiativeKey: "f", name: "项目 F", sector: "B2B", department: "MKT", resourceType: "MRD" },
];

it("combines selections with OR within each filter and AND across filters", () => {
  expect(filterManagementItems(items, {
    sector: ["PCMO", "B2B"],
    department: ["MKT", "ICE"],
    resourceType: ["MRD", "SP&A"],
    initiative: ["a", "b", "c", "d", "e"],
  }).map((item) => item.id)).toEqual(["1", "2"]);
  expect(filterManagementItems(items, { sector: [], initiative: [] })).toBe(items);
});

it("keeps same-name Initiatives distinct and preserves selections still available after a version change", () => {
  const fields = managementFilterFields(items.slice(0, 2));
  expect(fields.find(({ key }) => key === "initiative").options.map(({ value }) => value))
    .toEqual(["a", "b"]);
  expect(retainAvailableManagementFilters({
    sector: ["B2B", "CRTO"],
    initiative: ["a", "c"],
  }, fields)).toEqual({ sector: ["B2B"], initiative: ["a"] });
});
