import { beforeEach, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({ slots: [], cursor: 0, context: null }));
vi.mock("react", async (original) => ({
  ...(await original()),
  useState(initial) {
    const index = harness.cursor++;
    if (!(index in harness.slots)) harness.slots[index] = typeof initial === "function" ? initial() : initial;
    return [harness.slots[index], (value) => { harness.slots[index] = typeof value === "function" ? value(harness.slots[index]) : value; }];
  },
  useEffect: () => {},
  useId: () => "version-comparison-search",
  useMemo: (calculate) => calculate(),
}));
vi.mock("../src/workbench/WorkbenchContext.jsx", () => ({ useWorkbench: () => harness.context }));
import { VersionComparison } from "../src/workbench/pages/VersionComparison.jsx";

const original = { id: "1", initiativeKey: "one", name: "项目甲", ownerId: "old@example.test", budget: 100, rows: [], workflow: { confirmed: true } };
const current = { ...original, ownerId: "new@example.test" };
function render(executive = true, filters) { harness.cursor = 0; return VersionComparison({ executive, filters }); }
function nodes(element) {
  if (Array.isArray(element)) return element.flatMap(nodes);
  if (!element || typeof element !== "object" || !element.props) return [];
  return [element, ...nodes(element.props.children)];
}
beforeEach(() => {
  harness.context = { state: { planningVersions: [], planningVersion: { sourceVersionId: "202701" }, currentVersionId: "202702" }, data: { dealers: [] }, identity: { email: "a@example.test" } };
  harness.slots = ["202701", "202702", "initiative", { previous: [original], current: [current], dealers: [] }, "", false, "", null];
});
it("splits the current owner into a sortable cell and allows owner search", () => {
  let all = nodes(render());
  expect(all.some(node => node.props.children === "Owner")).toBe(true);
  expect(all.some(node => node.props.children === "new@example.test" && node.props.sortValue === "new@example.test")).toBe(true);
  expect(all.some(node => node.props.children === "old@example.test")).toBe(false);
  harness.slots[6] = "new@example.test";
  all = nodes(render());
  expect(all.some(node => node.props.children === "项目甲")).toBe(true);
  harness.slots[6] = "old@example.test";
  expect(nodes(render()).some(node => node.props.children === "项目甲")).toBe(false);
});
it("uses the previous owner for removed initiatives and keeps other views unchanged", () => {
  harness.slots[3].current = [];
  expect(nodes(render()).some(node => node.props.children === "old@example.test")).toBe(true);
  expect(nodes(render(false)).some(node => node.props.children === "Owner")).toBe(false);
  harness.slots[2] = "department";
  expect(nodes(render()).some(node => node.props.children === "Owner")).toBe(false);
});

it("matches management filters against each version's own attribution and the stable Initiative key", () => {
  const moved = {
    previous: { ...original, id: "older-budget", sector: "PCMO", department: "MKT", budget: 111 },
    current: { ...current, id: "newer-budget", sector: "B2B", department: "ICE", budget: 222 },
  };
  const another = { ...original, id: "other-budget", initiativeKey: "two", name: "项目乙", sector: "PCMO", department: "ICE", budget: 333 };
  harness.slots[3] = { previous: [moved.previous, another], current: [moved.current, another] };
  const all = nodes(render(true, { sector: ["PCMO", "B2B"], department: ["MKT"], initiative: ["one"] }));
  expect(all.some(node => node.props.children === "项目甲")).toBe(true);
  expect(all.some(node => node.props.children === "项目乙")).toBe(false);
  expect(all.some(node => node.props.sortValue === 111)).toBe(true);
  expect(all.some(node => node.props.sortValue === 222)).toBe(false);
});
