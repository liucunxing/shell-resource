import { describe, expect, it } from "vitest";
import { Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createTable,
  getCoreRowModel,
  getSortedRowModel,
} from "@tanstack/react-table";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  TableFooter,
} from "../src/components/ui/table";
import {
  cellSortValue,
  compareTableValues,
  normalizeSortValue,
  tableElements,
  tableHeaderLayout,
} from "../src/components/ui/table-sorting";
import { tableColumnAlignment } from "../src/components/ui/table-alignment";

describe("global table behavior", () => {
  it("keeps names and numeric identifiers left while centering numeric columns", () => {
    expect(tableColumnAlignment(<TableHead>经销商</TableHead>, [<TableCell>甲公司</TableCell>])).toBe("left");
    expect(tableColumnAlignment(<TableHead>Initiative</TableHead>, [<TableCell>零售返利计划</TableCell>])).toBe("left");
    expect(tableColumnAlignment(<TableHead>版本 / 来源</TableHead>, [<TableCell>202701</TableCell>])).toBe("left");
    expect(tableColumnAlignment(<TableHead>金额</TableHead>, [<TableCell>—</TableCell>, <TableCell sortValue={-1200.12}>-1,200.1</TableCell>])).toBe("center");
    expect(tableColumnAlignment(<TableHead>占比</TableHead>, [<TableCell className="num">—</TableCell>])).toBe("center");
    expect(tableColumnAlignment(<TableHead>获配项目数</TableHead>, [<TableCell>5 个 Initiative</TableCell>])).toBe("center");
    expect(tableColumnAlignment(<TableHead>预留原因</TableHead>, [<TableCell>专项对象待定</TableCell>])).toBe("left");
    expect(tableColumnAlignment(<TableHead>Owner 说明</TableHead>, [<TableCell>需要补充说明</TableCell>])).toBe("left");
  });
  it("aligns manual grouped headers with their data columns, including missing values", () => {
    const html = renderToStaticMarkup(<Table sortingMode="manual">
      <TableHeader>
        <TableRow><TableHead rowSpan={2}>经销商</TableHead><TableHead colSpan={2}>历史</TableHead></TableRow>
        <TableRow><TableHead>Vol</TableHead><TableHead>C3</TableHead></TableRow>
      </TableHeader>
      <TableBody><TableRow><TableCell>甲公司</TableCell><TableCell className="num">—</TableCell><TableCell>12.5</TableCell></TableRow></TableBody>
      <TableFooter><TableRow><TableCell>合计</TableCell><TableCell>—</TableCell><TableCell>12.5</TableCell></TableRow></TableFooter>
    </Table>);
    expect(html).toMatch(/data-align="left"[^>]*>经销商<\/th>/);
    expect(html).toMatch(/data-align="center"[^>]*>历史<\/th>/);
    for (const value of ["Vol", "C3", "—", "12.5"]) expect(html).toContain(`data-align="center">${value}<`);
    for (const value of ["甲公司", "合计"]) expect(html).toContain(`data-align="left">${value}<`);
  });
  it("compares signed numbers, decimals, percentages and thousands numerically; missing is not zero", () => {
    expect(
      ["1,200.25", "−3.5pp", "0%", "—", "无基期"].map(normalizeSortValue),
    ).toEqual([1200.25, -3.5, 0, undefined, undefined]);
    expect(normalizeSortValue("SD-A / RSM-2")).toBe("SD-A / RSM-2");
    expect(normalizeSortValue("2026-11-15")).toBe("2026-11-15");
    expect(normalizeSortValue(Infinity)).toBeUndefined();
  });
  it("sorts exact values before display rounding and keeps missing last in both directions", () => {
    const data = [null, 10.004, -3, 2, 10.003, null].map((value, id) => ({
      id,
      value,
    }));
    for (const desc of [false, true]) {
      const table = createTable({
        data,
        columns: [
          {
            id: "value",
            accessorFn: (r) => normalizeSortValue(r.value),
            sortUndefined: "last",
            sortingFn: (a, b, id) =>
              compareTableValues(a.getValue(id), b.getValue(id)),
          },
        ],
        state: { sorting: [{ id: "value", desc }] },
        onStateChange: () => {},
        renderFallbackValue: null,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
      });
      expect(table.getRowModel().rows.map((r) => r.original.id)).toEqual(
        desc ? [1, 4, 3, 2, 0, 5] : [2, 3, 4, 1, 0, 5],
      );
    }
    expect(data.map((r) => r.id)).toEqual([0, 1, 2, 3, 4, 5]);
  });
  it("reads controlled inputs and explicit chart accessors, excluding secondary annotations", () => {
    expect(
      cellSortValue(
        <TableCell>
          <input value="-22" readOnly />
        </TableCell>,
      ),
    ).toBe(-22);
    expect(
      cellSortValue(
        <TableCell>
          <select value="b" readOnly>
            <option value="a">甲</option>
            <option value="b">乙</option>
          </select>
        </TableCell>,
      ),
    ).toBe("乙");
    expect(
      cellSortValue(
        <TableCell>
          <input type="checkbox" checked readOnly />
        </TableCell>,
      ),
    ).toBe(1);
    expect(
      cellSortValue(
        <TableCell sortValue={7.001}>
          7.00<small>上涨 90%</small>
        </TableCell>,
      ),
    ).toBe(7.001);
    expect(
      cellSortValue(
        <TableCell sortValue={null}>
          <span>不可比较</span>
        </TableCell>,
      ),
    ).toBeUndefined();
  });
  it("maps two-tier headers and fragmented cells to matching leaf columns", () => {
    const layout = tableHeaderLayout(
      tableElements(
        <>
          <TableRow>
            <TableHead rowSpan={2}>名称</TableHead>
            <TableHead colSpan={2}>历史</TableHead>
            <TableHead rowSpan={2}>状态</TableHead>
          </TableRow>
          <TableRow>
            <TableHead>Vol</TableHead>
            <TableHead>C3</TableHead>
          </TableRow>
        </>,
      ),
    );
    expect(
      layout
        .flat()
        .filter((c) => c.leaf)
        .map((c) => c.column),
    ).toEqual([0, 3, 1, 2]);
    const cells = tableElements(
      <>
        <TableCell>A</TableCell>
        <Fragment key="history">
          <TableCell>12</TableCell>
          <TableCell>30</TableCell>
        </Fragment>
      </>,
    );
    expect(cells.map(cellSortValue)).toEqual(["A", 12, 30]);
  });
  it("provides keyboard buttons only on leaf data headings, with fixed footer and paged body", () => {
    const html = renderToStaticMarkup(
      <Table pageSize={1} pageIndex={1}>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead>金额</TableHead>
            <TableHead>操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {["a", "b", "c"].map((id, i) => (
            <TableRow key={id}>
              <TableCell>{id}</TableCell>
              <TableCell>{i}</TableCell>
              <TableCell>编辑</TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell colSpan={3}>添加记录</TableCell>
          </TableRow>
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell>合计</TableCell>
            <TableCell>3</TableCell>
          </TableRow>
        </TableFooter>
      </Table>,
    );
    expect(html).toContain('aria-label="按金额排序"');
    expect(html).not.toContain('aria-label="按操作排序"');
    expect(html).toContain(">b</td>");
    expect(html).not.toContain(">a</td>");
    expect(html).toContain("添加记录");
    expect(html).toContain("合计");
    expect(html).not.toContain("sortValue=");
  });
});
