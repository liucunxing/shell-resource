import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LegendColorProvider, DepartmentLabel, resolveInitiativeColor, resolveResourceColor, resolveDepartmentColor } from "../src/workbench/LegendColors";
import { ResourceMixDonut, InitiativeContributionBar } from "../src/workbench/pages/ResourceDetailCharts";
import { InitiativeChip } from "../src/workbench/pages/V19PortfolioVisuals.jsx";
import { AdminLegendColors, legendColorPayload } from "../src/workbench/pages/AdminLegendColors.jsx";
import { useWorkbench } from "../src/workbench/WorkbenchContext.jsx";

vi.mock("../src/workbench/WorkbenchContext.jsx", () => ({ useWorkbench: vi.fn() }));
const item = { id: "21", initiativeKey: "INI-004", name: "项目甲" };
const colors = { initiatives: { "INI-004": "#123456" }, resources: { MRD: "#234567" }, departments: { MKT: "#345678" } };
describe("configured legend colors", () => {
  it("follows stable Initiative keys across versions and preserves default aliases", () => {
    expect(resolveInitiativeColor(item, colors)).toBe(resolveInitiativeColor(item));
    expect(resolveInitiativeColor({ ...item, id: "99" }, colors)).toBe(resolveInitiativeColor(item));
    expect(resolveResourceColor("CAPEX")).toBe(resolveResourceColor("Capex"));
    expect(resolveResourceColor("BTL")).toBe(resolveResourceColor("SP&A"));
    expect(resolveDepartmentColor("mkt", colors)).toBe("#345678");
  });
  it("renders configured colors in shared charts and labels without leaking between providers", () => {
    const child = <><InitiativeChip item={item} name={item.name} onClick={() => {}} /><ResourceMixDonut parts={[{type:"MRD",amount:5}]} title="资源" center="5" unit="元" /><InitiativeContributionBar sources={[{id:"21", key:"INI-004", name:"甲",amount:5}]} maxAmount={5} /><DepartmentLabel name="MKT" /></>;
    const configured = renderToStaticMarkup(<LegendColorProvider colors={colors}>{child}</LegendColorProvider>);
    expect(configured).not.toContain("#123456");
    expect(configured).toContain('stroke="#234567"');
    expect(configured).toContain("#345678");
    const defaults = renderToStaticMarkup(<LegendColorProvider>{child}</LegendColorProvider>);
    expect(defaults).not.toContain("#123456");
    expect(defaults).not.toContain("#234567");
  });
  it("stores only overrides; empty fields restore defaults and invalid values are rejected", () => {
    expect(legendColorPayload({initiatives:{b:"#AABBCC"}, resources:{MRD:"#abcdef"}})).toEqual({initiatives:{b:"#AABBCC"},resources:{MRD:"#ABCDEF"},departments:{}});
    expect(() => legendColorPayload({ resources: { MRD: "red" } })).toThrow();
    expect(() => legendColorPayload({ resources: { MRD: "#fff" } })).toThrow();
    expect(resolveResourceColor("MRD", {resources:{MRD:"url(https://bad)"}})).toBe("#003C88");
  });
  it("exposes only resource and department settings while retaining stored legacy values", () => {
    vi.mocked(useWorkbench).mockReturnValue({ state: { legendColors: colors, initiatives: [item] }, view: { initiatives: [item] }, identity: { email: "admin@example.test" }, saveConfig: vi.fn(), previewMode: false } as never);
    const html = renderToStaticMarkup(<AdminLegendColors />);
    expect(html).toContain("资源大类");
    expect(html).toContain("部门");
    expect(html).not.toContain('>Initiative</button>');
    expect(html).not.toContain("项目甲颜色选择");
    expect(legendColorPayload(colors).initiatives).toEqual(colors.initiatives);
  });
});
