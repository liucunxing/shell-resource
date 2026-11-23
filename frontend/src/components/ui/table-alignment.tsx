import { cellSortValue, tableText, type tableElements } from "./table-sorting";

type Cell = ReturnType<typeof tableElements>[number];
export type TableAlignment = "left" | "center";

/** Align by column meaning, so missing values and grouped headers stay consistent. */
export function tableColumnAlignment(header: Cell, cells: Cell[]): TableAlignment {
  const explicit = header.props["data-align"];
  if (explicit === "left" || explicit === "center") return explicit;
  const numericClass = (cell: Cell) => /(?:^|\s)(num|text-right|text-center)(?:\s|$)/.test(cell.props.className || "");
  if (numericClass(header)) return "center";
  const label = tableText(header.props.children).replace(/[↑↓↕]/g, "").trim();
  if (!label || /^(操作|选择)$/.test(label)) return "center";
  // Numeric-looking identifiers (version numbers, distributor codes) are labels.
  if (/^(Initiative|经销商(?:名称)?|名称|SD|RSM|Sector|Owner|资源大类|原因|版本(?:\s*\/\s*来源)?|编码|编号|项目|用户|邮箱|部门|业务线)(?:$|\s*[·/（(])/i.test(label)) return "left";
  if (/(说明|原因|名称|编码|编号|状态|时间|日期)/.test(label)) return "left";
  if (cells.some(numericClass)) return "center";
  if (/(金额|占比|数量|家数|项目数|客均|差值|偏离|预算|已分配|待分配|预留|合同量|target|Delivery\s*Vol|Actual\s*C3|Yield)(?:[（(\s]|$)/i.test(label)) return "center";
  const values = cells.map(cellSortValue).filter((value) => value !== undefined);
  return values.length > 0 && values.every((value) => typeof value === "number")
    ? "center"
    : "left";
}
