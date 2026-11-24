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
 book.removeWorksheet(book.getWorksheet("经销商列表").id);
 result=await X.previewRosterImport(await book.xlsx.writeBuffer(),state,"I",identity,dealers); expect(result.errors).toEqual([]);
 book.addWorksheet("未知工作表");
 result=await X.previewRosterImport(await book.xlsx.writeBuffer(),state,"I",identity,dealers); expect(result.errors.join()).toContain("请使用下载的");
 book.removeWorksheet(book.getWorksheet("未知工作表").id);
 sheet.addRow(["D1","Dealer","East","Two","Active",1]); result=await X.previewRosterImport(await book.xlsx.writeBuffer(),state,"I",identity,dealers); expect(result.errors.join()).toContain("重复");
 sheet.getCell("D3").value="missing"; sheet.getCell("F2").value={formula:"1+1",result:2}; result=await X.previewRosterImport(await book.xlsx.writeBuffer(),state,"I",identity,dealers); expect(result.errors.join()).toContain("无法唯一匹配"); expect(result.errors.join()).toContain("不支持公式");
 result=await X.previewRosterImport(await book.xlsx.writeBuffer(),state,"I",{...identity,ownerId:"other"},dealers); expect(result.errors.length).toBeGreaterThan(0);
});
it("replaces the selected roster, releasing removed amounts while keeping reserves and selected zero rows", async () => {
  const identity = { role: "owner", department: "MKT", ownerId: "owner", apiMode: true };
  const dealers = ["A", "B"].map(id => ({ id, code: id, name: id, sector: "OEM", sd: "East", rsm: "One", status: "active" }));
  const rows = dealers.map(dealer => ({ dealerId: dealer.id, amount: 0, note: "" }));
  rows[0].amount = 25;
  const otherBudgets = [{ id: "r", amount: 10, note: "reserve" }];
  const item = { id: "I", ownerId: "owner", sector: "OEM", department: "MKT", budget: 100, revision: 1, rows, otherBudgets };
  const state = { departments: { MKT: { status: "collecting", versions: [] } }, initiatives: [item] };
  const file = await X.exportSelectedRoster([rows[1]], dealers);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file);
  expect(workbook.getWorksheet("已选经销商").getColumn(4).hidden).toBe(true);
  workbook.getWorksheet("已选经销商").getCell("D2").value = "";
  const withoutRsm = await X.previewRosterImport(await workbook.xlsx.writeBuffer(), state, item.id, identity, dealers);
  expect(withoutRsm.errors).toEqual([]);
  expect(withoutRsm.rows[0].dealerId).toBe("B");
  const ambiguousDealers = [...dealers, { ...dealers[1], id: "B2", rsm: "Other" }];
  const ambiguous = await X.previewRosterImport(await workbook.xlsx.writeBuffer(), state, item.id, identity, ambiguousDealers);
  expect(ambiguous.errors.join()).toContain("无法唯一匹配");
  const preview = await X.previewRosterImport(file, state, item.id, identity, dealers);
  expect(preview.errors).toEqual([]);
  expect(preview.rosterEntries).toEqual([
    { dealerId: "B", before: rows[1], after: rows[1] },
    { dealerId: "A", before: rows[0], after: null },
  ]);
  expect(preview.rows).toEqual([rows[1]]);
  expect(preview.summary).toEqual({ before: 25, after: 0, otherBudget: 10, gap: 90 });
  expect(preview.otherBudgets).toEqual(otherBudgets);

  const unchangedFile = await X.exportSelectedRoster(rows, dealers);
  const unchanged = await X.previewRosterImport(unchangedFile, state, item.id, identity, dealers);
  expect(unchanged.errors).toEqual([]);
  expect(unchanged.summary).toEqual({ before: 25, after: 25, otherBudget: 10, gap: 65 });

  const emptyFile = await X.exportSelectedRoster([], dealers);
  const empty = await X.previewRosterImport(emptyFile, state, item.id, identity, dealers);
  expect(empty.errors).toEqual([]);
  expect(empty.rows).toEqual([]);
  expect(empty.rosterEntries).toEqual(rows.map(before => ({ dealerId: before.dealerId, before, after: null })));
  expect(item.rows).toHaveLength(2);
});
