import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { InitiativeSwitcher } from "../src/workbench/pages/InitiativeSwitcher";
import { LegendColorProvider } from "../src/workbench/LegendColors";
import E from "../src/workbench/domain/engine.js";
import D from "../src/workbench/domain/demo-data.json";

const initiatives = [
  { id: "1", initiativeKey: "A", name: "Regional KA support", sector: "PCMO" },
  { id: "2", initiativeKey: "B", name: "Consumer Ultra Trade", sector: "PCMO" },
  { id: "3", initiativeKey: "C", name: "Branding LV+PVC", sector: "PCMO" },
];

describe("editor initiative buttons", () => {
  it("shows all authorized choices as buttons with configured colors and a pressed current choice", () => {
    const html = renderToStaticMarkup(<LegendColorProvider colors={{ initiatives: { A: "#123456" } }}>
      <InitiativeSwitcher initiatives={initiatives} currentId="1" onSelect={() => {}} />
    </LegendColorProvider>);
    expect(html.match(/<button /g)).toHaveLength(3);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toContain("--initiative-color:#123456");
    expect(html).toContain("grid-template-columns:repeat(2, max-content)");
    expect(html).not.toContain("<select");
    expect(html).not.toContain('role="combobox"');
  });

  it("selects an explicit project without reselecting the current project", () => {
    const select = vi.fn();
    const element = InitiativeSwitcher({ initiatives, currentId: "1", onSelect: select });
    const buttons = element.props.children[1].props.children.props.children;
    buttons[0].props.onClick();
    expect(select).not.toHaveBeenCalled();
    buttons[2].props.onClick();
    expect(select).toHaveBeenCalledWith("3");
  });

  it("does not add projects to an empty authorized view", () => {
    expect(InitiativeSwitcher({ initiatives: [], currentId: "", onSelect: vi.fn() })).toBeNull();
  });
});

describe("unsaved adjustment reason", () => {
  function setup() {
    const state = E.createState(D, "working");
    const project = state.initiatives[0];
    const identity = { role: "owner", ownerId: project.ownerId, department: [project.department] };
    return { state, project, identity };
  }
  it("persists a valid reason in the project draft without affecting another project", () => {
    const { state, project, identity } = setup();
    const revision = project.revision;
    const other = structuredClone(state.initiatives[1]);
    E.updateInitiative(state, project.id, { changeReason: "经销商名单调整" }, identity, D);
    const returned = E.selectView(state, identity).initiatives.find(item => item.id === project.id);
    expect(returned?.changeReason).toBe("经销商名单调整");
    expect(project.revision).toBe(revision + 1);
    expect(project.savedAt).toBeTruthy();
    expect(state.initiatives[1]).toEqual(other);
  });
  it("rejects invalid reason text and still enforces ownership", () => {
    const { state, project, identity } = setup();
    expect(() => E.updateInitiative(state, project.id, { changeReason: "长".repeat(161) }, identity, D)).toThrow();
    expect(() => E.updateInitiative(state, project.id, { changeReason: 12 }, identity, D)).toThrow();
    expect(() => E.updateInitiative(state, project.id, { changeReason: "调整" }, { ...identity, ownerId: "other" }, D)).toThrow();
  });
});
