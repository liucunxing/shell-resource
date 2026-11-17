import { beforeEach, expect, it, vi } from "vitest";
const harness = vi.hoisted(() => ({ slots: [], cursor: 0 }));
vi.mock("react", async original => ({ ...(await original()), useState(initial) {
 const index=harness.cursor++; if(!(index in harness.slots)) harness.slots[index]=typeof initial==="function"?initial():initial;
 return [harness.slots[index],value=>{harness.slots[index]=typeof value==="function"?value(harness.slots[index]):value;}];
}}));
vi.mock("../src/workbench/LegendColors", async original => ({ ...(await original()),useLegendColors:()=>({resourceColor:()=>"#003C88",initiativeColor:()=>"#003C88"}) }));
import { V19Stack } from "../src/workbench/pages/V19PortfolioVisuals.jsx";
import { allocationColumnGroups } from "../src/workbench/domain/allocation-detail";
const items=[{id:"i",name:"Project",resourceType:"MRD",sector:"PCMO",budget:100000,rows:[{dealerId:"a",amount:60000},{dealerId:"b",amount:30000},{dealerId:"c",amount:10000}],otherBudgets:[]}];
const dealers=[
 {id:"a",name:"Dealer A",code:"001",sector:"PCMO",sd:"East",rsm:"R1",history:{c32025:2000,vol2025:10000,contract2025:20000,phasing2025:0,totalInvestment2025:1000,resources2025:{MRD:1200,"SP&A":-200}}},
 {id:"b",name:"Dealer B",code:"002",sector:"PCMO",sd:"West",rsm:"R2",history:{c32025:8000,vol2025:30000,contract2025:null,phasing2025:null,totalInvestment2025:4000,resources2025:{MRD:4000}}},
 {id:"c",name:"No history",code:"003",sector:"PCMO",sd:"North",rsm:"R3",history:{}},
];
function nodes(node){ if(Array.isArray(node))return node.flatMap(nodes); if(!node?.props)return [];return [node,...nodes(node.props.children)]; }
function text(node){ if(Array.isArray(node))return node.map(text).join("");if(node?.props)return text(node.props.children);return typeof node==="string"||typeof node==="number"?String(node):""; }
function render(props={items,dealers}){harness.cursor=0;return V19Stack(props);}
const cells=(tree,key)=>nodes(tree).filter(n=>n.props["data-column"]===key&&Object.hasOwn(n.props,"sortValue"));
const headers=tree=>nodes(tree).filter(n=>n.props["data-column"]&&Object.hasOwn(n.props,"aria-sort"));
beforeEach(()=>{harness.slots=[];});
it("uses detail columns without support/note, plus resource mix and authorized expenses",()=>{
 const keys=headers(render()).map(n=>n.props["data-column"]);
 expect(keys.filter(k=>k!=="mix" && k!=="code")).toEqual(allocationColumnGroups(["MRD","SP&A"]).filter(g=>g.key!=="support").flatMap(g=>g.columns.map(c=>c[0])));
 for(const key of ["initiative","support","note","expense:Capex","expense:ICE Rebate"])expect(keys).not.toContain(key);
});
it("keeps pp bars, full-roster denominators, units, signed expenses and zero versus null",()=>{
 const tree=render();
 expect(text(cells(tree,"amountShare")[0])).toBe("60.0%");
 expect(text(cells(tree,"gapC3")[0])).toBe("+40.0pp");
 expect(nodes(cells(tree,"gapC3")[0]).some(n=>n.props.className==="v19-diverging")).toBe(true);
 expect(text(cells(tree,"contract")[0])).toBe("20.00");
 expect(text(cells(tree,"c3")[0])).toBe("2.00");
 expect(text(cells(tree,"investment")[0])).toBe("1.00");
 expect(text(cells(tree,"expense:SP&A")[0])).toBe("-0.20");
 expect(text(cells(tree,"phasing")[0])).toBe("0.0%");
 expect(text(cells(tree,"phasing")[1])).toBe("—");
});
it("makes missing-history dealers searchable without changing shares",()=>{
 let tree=render();nodes(tree).find(n=>n.props["aria-label"]==="搜索叠加经销商").props.onChange({target:{value:"003"}});
 tree=render();expect(cells(tree,"name")).toHaveLength(1);expect(text(cells(tree,"name")[0])).toContain("No history");
 expect(text(cells(tree,"gapC3")[0])).toBe("—");expect(text(cells(tree,"amountShare")[0])).toBe("10.0%");
 nodes(tree).find(n=>n.props["aria-label"]==="搜索叠加经销商").props.onChange({target:{value:""}});expect(cells(render(),"name")).toHaveLength(3);
});
it("sorts an added numeric column in both directions",()=>{
 let tree=render();const click=()=>nodes(headers(tree).find(n=>n.props["data-column"]==="c3")).find(n=>n.props.onClick).props.onClick();
 click();tree=render();expect(cells(tree,"c3").map(text)).toEqual(["2.00","8.00","—"]);
 click();tree=render();expect(cells(tree,"c3").map(text)).toEqual(["8.00","2.00","—"]);
});

it("paginates the full roster and keeps the top ten marked after sorting and filtering",()=>{
 const manyDealers=Array.from({length:25},(_,i)=>({id:`d${i}`,name:`Dealer ${String(i).padStart(2,"0")}`,code:`${i}`,sector:"PCMO",history:{c32025:i+1}}));
 const manyItems=[{id:"i",name:"Project",resourceType:"MRD",sector:"PCMO",budget:2500,rows:manyDealers.map(d=>({dealerId:d.id,amount:100})),otherBudgets:[]}];
 const props={items:manyItems,dealers:manyDealers};
 let tree=render(props);
 expect(cells(tree,"name")).toHaveLength(20);
 expect(text(tree)).toContain("筛选 25 / 25 家 · 本页 20 家");
 expect(nodes(tree).filter(n=>n.props.className==="v20-stack-rank")).toHaveLength(10);
 expect(text(tree)).not.toContain("查看全部");
 nodes(tree).find(n=>text(n)==="下一页"&&n.props.onClick).props.onClick();
 tree=render(props); expect(cells(tree,"name")).toHaveLength(5); expect(text(tree)).toContain("2 / 2");
 nodes(tree).find(n=>n.props["aria-label"]==="搜索叠加经销商").props.onChange({target:{value:"Dealer 00"}});
 tree=render(props); expect(cells(tree,"name")).toHaveLength(1); expect(text(cells(tree,"rank")[0])).toContain("Top 1"); expect(text(tree)).toContain("1 / 1");
});

it("renders and sorts dealer codes separately without changing top rankings",()=>{
 let tree=render();
 expect(text(cells(tree,"name")[0])).not.toContain("001");
 expect(cells(tree,"code").map(text)).toEqual(["001","002","003"]);
 const button=nodes(headers(tree).find(n=>n.props["data-column"]==="code")).find(n=>n.props.onClick);
 button.props.onClick(); tree=render();
 expect(cells(tree,"code").map(text)).toEqual(["001","002","003"]);
 expect(text(cells(tree,"rank")[0])).toContain("Top 1");
 button.props.onClick(); tree=render();
 expect(cells(tree,"code").map(text)).toEqual(["003","002","001"]);
 expect(text(cells(tree,"rank")[2])).toContain("Top 1");
});
