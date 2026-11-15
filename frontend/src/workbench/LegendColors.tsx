import "./legend-colors.css";
import {
  createContext,
  useContext,
  type CSSProperties,
  type ReactNode,
} from "react";

export type LegendColors = {
  initiatives?: Record<string, string>;
  resources?: Record<string, string>;
  departments?: Record<string, string>;
};
export type ColorInitiative = {
  id?: string | number;
  key?: string;
  initiativeKey?: string;
  name?: string;
};
export const VALID_LEGEND_COLOR = /^#[0-9a-f]{6}$/i;
export const DEFAULT_RESOURCE_COLORS: Record<string, string> = {
  MRD: "#003C88",
  "SP&A": "#008443",
  "ICE Rebate": "#EB8705",
  Capex: "#641964",
};
const palette = [
  "#EB8705",
  "#003C88",
  "#BED600",
  "#008443",
  "#89CFDC",
  "#7F7F7F",
  "#DD1D21",
];
export const initiativeLegendKey = (item: ColorInitiative) =>
  String(item.initiativeKey || item.key || item.id || item.name);
const configured = (value?: string) =>
  value && VALID_LEGEND_COLOR.test(value) ? value : undefined;
export function resolveInitiativeColor(
  item: ColorInitiative,
  colors: LegendColors = {},
) {
  const key = initiativeLegendKey(item);
  const numeric = Number(key.replace(/\D/g, ""));
  const hash = numeric
    ? numeric - 1
    : [...key].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 0);
  return (
    configured(colors.initiatives?.[key]) || palette[hash % palette.length]
  );
}
export function resolveResourceColor(type: string, colors: LegendColors = {}) {
  const key = type === "CAPEX" ? "Capex" : type === "BTL" ? "SP&A" : type;
  return (
    configured(colors.resources?.[key]) ||
    DEFAULT_RESOURCE_COLORS[key] ||
    "#89CFDC"
  );
}
export function resolveDepartmentColor(
  name: string,
  colors: LegendColors = {},
) {
  const key = name.toUpperCase();
  return (
    configured(colors.departments?.[key]) ||
    (
      { MKT: "#003C88", ICE: "#EB8705", CAPEX: "#641964" } as Record<
        string,
        string
      >
    )[key] ||
    "#52616C"
  );
}
const LegendContext = createContext<LegendColors>({});
export function LegendColorProvider({
  colors = {},
  children,
}: {
  colors?: LegendColors;
  children: ReactNode;
}) {
  return (
    <LegendContext.Provider value={colors}>{children}</LegendContext.Provider>
  );
}
export function useLegendColors() {
  const colors = useContext(LegendContext);
  return {
    colors,
    initiativeColor: (item: ColorInitiative) =>
      resolveInitiativeColor(item, colors),
    resourceColor: (type: string) => resolveResourceColor(type, colors),
    departmentColor: (name: string) => resolveDepartmentColor(name, colors),
  };
}
export function InitiativeLabel({ item }: { item: ColorInitiative }) {
  const { initiativeColor } = useLegendColors();
  return (
    <span
      className="v20-initiative-chip"
      style={{ "--initiative-color": initiativeColor(item) } as CSSProperties}
    >
      {item.name}
    </span>
  );
}
export function DepartmentLabel({ name }: { name: string }) {
  const { departmentColor } = useLegendColors();
  return (
    <span className="legend-department-label">
      <i aria-hidden="true" style={{ background: departmentColor(name) }} />
      {name}
    </span>
  );
}
