import { expect, it } from "vitest";
import ExcelJS from "exceljs";
import X from "../src/workbench/domain/excel.js";
it("imports roster with identity, duplicate and amount validation", async () => {
 const identity={role:"owner",department:"MKT",ownerId:"owner",apiMode:true};
 const dealers=["One","Two"].map(rsm=>({id:rsm,code:"D1",name:"Dealer",sector:"PCMO",sd:"East",rsm,status:"active"}));
 const item={id:"I",name:"Test",sector:"PCMO",department:"MKT",resourceType:"MRD",ownerId:"owner",budget:1000,revision:1,rows:[{dealerId:"One",amount:50,note:"keep"}],otherBudgets:[{id:"r",amount:10,note:"reserve"}]};
 const state={departments:{MKT:{status:"collecting",versions:[]}},initiatives:[item]};
 const book=new ExcelJS.Workbook(); await book.xlsx.load(await X.exportSelectedRoster(item.rows,dealers));
 const sheet=book.getWorksheet("已选经销商"); sheet.getCell("F2").value=75; sheet.addRow(["D1","Dealer","East","Two","Active",100]);
 let result=await X.previewRosterImport(await book.xlsx.writeBuffer(),state,"I",identity,dealers);
 expect(result.errors).toEqual([]); expect(result.rows).toEqual([{dealerId:"One",amount:75,note:"keep"},{dealerId:"Two",amount:100,note:""}]);
 expect(result.otherBudgets).toEqual(item.otherBudgets); expect(item.rows[0].amount).toBe(50);
 sheet.addRow(["D1","Dealer","East","Two","Active",1]); result=await X.previewRosterImport(await book.xlsx.writeBuffer(),state,"I",identity,dealers); expect(result.errors.join()).toContain("重复");
 sheet.getCell("D3").value="missing"; sheet.getCell("F2").value={formula:"1+1",result:2}; result=await X.previewRosterImport(await book.xlsx.writeBuffer(),state,"I",identity,dealers); expect(result.errors.join()).toContain("无法唯一匹配"); expect(result.errors.join()).toContain("不支持公式");
 result=await X.previewRosterImport(await book.xlsx.writeBuffer(),state,"I",{...identity,ownerId:"other"},dealers); expect(result.errors.length).toBeGreaterThan(0);
});
