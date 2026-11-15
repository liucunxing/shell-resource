import * as React from "react";

export type SortValue = string | number | boolean | null | undefined;
type Element = React.ReactElement<Record<string, any>>;

// Work with React elements, never move DOM nodes behind React's back. Original
// row keys and event closures survive sorting (including editable rows).
export function tableElements(children: React.ReactNode): Element[] {
  return React.Children.toArray(children).flatMap((child) => {
    if (!React.isValidElement(child)) return [];
    const element = child as Element;
    return element.type === React.Fragment
      ? tableElements(element.props.children)
      : [element];
  });
}

export function tableText(node: React.ReactNode): string {
  return React.Children.toArray(node)
    .map((child): string => {
      if (typeof child === "string" || typeof child === "number")
        return String(child);
      if (!React.isValidElement(child)) return "";
      const { props, type } = child as Element;
      if (props["aria-hidden"] || type === "svg" || type === "small") return "";
      if ("checked" in props) return props.checked ? "1" : "0";
      if ("value" in props) {
        const option = tableElements(props.children).find(
          (item) => item.props.value === props.value,
        );
        return option
          ? tableText(option.props.children)
          : String(props.value ?? "");
      }
      return tableText(props.children);
    })
    .join("")
    .trim();
}

export function normalizeSortValue(
  value: SortValue,
): string | number | undefined {
  if (
    value == null ||
    value === "" ||
    (typeof value === "number" && !Number.isFinite(value))
  )
    return undefined;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return Number(value);
  const text = value.trim();
  if (/^(—|–|-|未提供|无基期|来源未提供)$/.test(text)) return undefined;
  // Only parse an entire numeric value. Codes, dates, paired values and prose
  // remain text unless the business cell supplies an explicit sortValue.
  const match = text
    .replaceAll(",", "")
    .replace("−", "-")
    .match(/^([+-]?\d+(?:\.\d+)?)\s*(?:%|pp|家|个|元|万元|万|KL|K\$)?$/);
  return match ? Number(match[1]) : text;
}

export function cellSortValue(cell: Element | undefined) {
  if (!cell) return undefined;
  return normalizeSortValue(
    Object.hasOwn(cell.props, "sortValue")
      ? cell.props.sortValue
      : tableText(cell.props.children),
  );
}

export function compareTableValues(a: unknown, b: unknown) {
  return typeof a === "number" && typeof b === "number"
    ? a - b
    : String(a ?? "").localeCompare(String(b ?? ""), "zh-CN", {
        numeric: true,
      });
}

// Resolve leaf coordinates across arbitrary colSpan/rowSpan header groups.
export function tableHeaderLayout(rows: Element[]) {
  const occupied: boolean[][] = [];
  return rows.map((row, ri) => {
    let column = 0;
    return tableElements(row.props.children).map((cell) => {
      while (occupied[ri]?.[column]) column++;
      const start = column;
      const span = Number(cell.props.colSpan || 1);
      const height = Number(cell.props.rowSpan || 1);
      for (let r = ri; r < ri + height; r++) {
        occupied[r] ||= [];
        for (let c = start; c < start + span; c++) occupied[r][c] = true;
      }
      column += span;
      return {
        cell,
        column: start,
        leaf: span === 1 && ri + height >= rows.length,
      };
    });
  });
}
