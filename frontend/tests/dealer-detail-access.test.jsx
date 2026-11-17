import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DealerDetailAccessProvider, DealerDetailButton } from "../src/workbench/DealerDetailAccess";
import { ResourceDetailDrawer } from "../src/workbench/pages/ResourceDetailDrawer";
import { V19Stack } from "../src/workbench/pages/V19PortfolioVisuals.jsx";
const items = [{ id: "i", name: "项目一", resourceType: "MRD", sector: "PCMO", budget: 100, rows: [{dealerId:"a",amount:90},{dealerId:"b",amount:10}], otherBudgets: [] }];
const dealers = [{id:"a",name:"经销商甲",sector:"PCMO",history:{c32025:25,vol2025:25}},{id:"b",name:"经销商乙",sector:"PCMO",history:{c32025:75,vol2025:75}}];
describe("dealer drawer role access", () => {
  it.each(["owner", "lead", "management", "admin"])("renders appropriate dealer controls for %s", role => {
    const html = renderToStaticMarkup(<DealerDetailAccessProvider role={role}><DealerDetailButton variant="link" onClick={() => {}}>经销商甲</DealerDetailButton><V19Stack items={items} dealers={dealers}/></DealerDetailAccessProvider>);
    expect(html.includes("Initiative")).toBe(false);
    expect(html.includes("v20-initiative-chips")).toBe(false);
    expect(/<button[^>]*>经销商甲<\/button>/.test(html)).toBe(role !== "owner");
    expect(html).toContain("投资金额（万元）");
    expect(html).toContain("C3占比");
  });
  it("blocks a direct dealer drawer request for an owner", () => {
    const html = renderToStaticMarkup(<DealerDetailAccessProvider role="owner"><ResourceDetailDrawer detail={{type:"dealer",dealerId:"a"}} items={items} dealers={dealers} onClose={()=>{}}/></DealerDetailAccessProvider>);
    expect(html).toBe("");
  });
});
