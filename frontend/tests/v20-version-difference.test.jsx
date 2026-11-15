import { expect, it } from "vitest";
import { versionDifferenceDetail } from "../src/workbench/pages/VersionDifferenceDrawer.jsx";
import { submittedVersionItems } from "../src/workbench/domain/version-baseline.js";

const before = {
  id: "left-id",
  initiativeKey: "stable",
  name: "项目",
  sector: "PCMO",
  department: "MKT",
  resourceType: "MRD",
  budget: 100000,
  selected: ["a", "gone"],
  rows: [
    { dealerId: "a", sd: "Old SD", rsm: "Old RSM", amount: 40000 },
    { dealerId: "gone", amount: 10000 },
  ],
  otherBudgets: [{ reasonId: "reserve", amount: 20000 }],
  allocationVisible: true,
  workflow: { confirmed: true },
};
const after = {
  ...before,
  id: "right-id",
  budget: 150000,
  selected: ["a", "new"],
  rows: [
    { dealerId: "a", sd: "New SD", rsm: "New RSM", amount: 60000 },
    { dealerId: "new", amount: 30000 },
  ],
  otherBudgets: [{ reasonId: "reserve", amount: 10000 }],
};
const dealers = ["a", "gone", "new"].map((id) => ({
  id,
  name: id,
  sector: "PCMO",
  sd: "Master SD",
  rsm: "Master RSM",
  history: {},
}));
const result = {
  previous: [before],
  current: [after],
  dealers,
  previousDealers: dealers,
  currentDealers: dealers,
};
const selection = { dimension: "initiative", key: "stable", name: "项目" };

it("compares both independent submitted snapshots with removed and added dealers", () => {
  const detail = versionDifferenceDetail(result, selection);
  expect(detail.left).toMatchObject({
    budget: 100000,
    allocation: 50000,
    reserve: 20000,
    available: true,
  });
  expect(detail.right).toMatchObject({
    budget: 150000,
    allocation: 90000,
    reserve: 10000,
    available: true,
  });
  expect(detail.dealers.find((row) => row.key === "PCMO:a")).toMatchObject({
    previous: { sd: "Old SD", rsm: "Old RSM" },
    current: { sd: "New SD", rsm: "New RSM" },
    delta: 20000,
  });
  expect(detail.dealers.find((row) => row.key === "PCMO:gone")).toMatchObject({
    previousAmount: 10000,
    currentAmount: 0,
    delta: -10000,
  });
  expect(detail.dealers.find((row) => row.key === "PCMO:new")).toMatchObject({
    previousAmount: 0,
    currentAmount: 30000,
    delta: 30000,
  });
});

it("marks one unsubmitted or unconfirmed side incomparable instead of inventing a zero", () => {
  for (const executive of [false, true]) {
    const current = executive
      ? { ...after, workflow: { confirmed: false } }
      : {
          ...after,
          allocationVisible: false,
          baselineAvailable: false,
          rows: [],
          otherBudgets: [],
        };
    const detail = versionDifferenceDetail(
      { ...result, current: [current] },
      selection,
      executive,
    );
    expect(detail.comparable).toBe(false);
    expect(detail.right.allocation).toBeNull();
    expect(detail.right.reserve).toBeNull();
    expect(
      detail.dealers.every(
        (row) => row.currentAmount === null && row.delta === null,
      ),
    ).toBe(true);
  }
});

it("resource dimensions use each version's own membership and cross-sector identities stay separate", () => {
  const moved = { ...after, resourceType: "SP&A" };
  const detail = versionDifferenceDetail(
    { ...result, current: [moved] },
    { dimension: "resourceType", key: "MRD" },
  );
  expect(detail.right.items).toHaveLength(0);
  expect(detail.dealers.find((row) => row.key === "PCMO:a").delta).toBe(-40000);
  const cross = {
    ...after,
    id: "b2b",
    initiativeKey: "another",
    sector: "B2B",
  };
  const scoped = versionDifferenceDetail(
    { ...result, current: [after, cross] },
    selection,
  );
  expect(scoped.dealers.every((row) => row.sector === "PCMO")).toBe(true);
});

it("selected versions use published snapshots rather than newer drafts on either side", () => {
  const workspace = (snapshot) => ({
    state: {
      initiatives: [{ ...snapshot, rows: [{ dealerId: "a", amount: 999999 }] }],
      publications: {
        [snapshot.id]: [{ initiative: snapshot, publishedRevision: 2 }],
      },
    },
  });
  const snapshots = {
    ...result,
    previous: submittedVersionItems(workspace(before)),
    current: submittedVersionItems(workspace(after)),
  };
  expect(versionDifferenceDetail(snapshots, selection).right.allocation).toBe(
    90000,
  );
  expect(versionDifferenceDetail(snapshots, selection).left.allocation).toBe(
    50000,
  );
});
