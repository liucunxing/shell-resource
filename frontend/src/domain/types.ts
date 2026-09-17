export const DEPARTMENTS = ["MKT", "ICE", "Capex"] as const;
export const SECTORS = ["PCMO", "CRTO", "B2B", "OEM"] as const;
export const RESOURCES = [
  "ICE Rebate",
  "MRD",
  "Capex",
  "SP&A BTL",
  "Commission Fee",
] as const;
export type Department = (typeof DEPARTMENTS)[number];
export type Sector = (typeof SECTORS)[number];
export type Resource = (typeof RESOURCES)[number];
export type Page =
  "home" | "database" | "allocation" | "adjust" | "submit" | "tracking";
export type Quarter = "Q1" | "Q2" | "Q3" | "Q4";
export interface Budget {
  id: string;
  sector: Sector;
  department: Department;
  resource: Resource;
  name: string;
  amount: number;
  pool: number;
  poolReason: string;
  basis: "Vol" | "C3";
  period: string;
  reservePercent: number;
  completed: boolean;
}
export interface HistoryRow {
  id: string;
  year: number;
  quarter: Quarter | "FY";
  sector: Sector;
  distributor: string;
  resource: Resource;
  vol: number;
  c3: number;
  spend: number;
}
export interface ForecastRow {
  id: string;
  year: number;
  sector: Sector;
  distributor: string;
  vol: number;
  c3: number;
}
export interface ApplicableRow {
  id: string;
  initiativeId: string;
  distributor: string;
  source: string;
  enabled: boolean;
}
export interface Allocation {
  id: string;
  initiativeId: string;
  distributor: string;
  initialAmount: number;
  amount: number;
  locked: boolean;
  explanation: string;
  basisLabel: string;
}
export interface TrackingRow {
  id: string;
  initiativeId: string;
  distributor: string;
  quarter: Quarter;
  actualSpendYtd: number;
  actualC3: number | null;
  forecastSpend: number | null;
  reason: string;
}
export interface Version {
  id: string;
  name: string;
  createdAt: string;
  note: string;
  budgets: Budget[];
  allocations: Allocation[];
  forecast: ForecastRow[];
}
export interface AuditEntry {
  id: string;
  time: string;
  text: string;
}
export interface WorkspaceState {
  schemaVersion: 1;
  dataMode: "demo" | "user";
  budgets: Budget[];
  history: HistoryRow[];
  forecast: ForecastRow[];
  applicable: ApplicableRow[];
  allocations: Allocation[];
  tracking: TrackingRow[];
  confirmed: Partial<Record<Department, boolean>>;
  versions: Version[];
  audit: AuditEntry[];
  updatedAt: string;
}
export interface Insight {
  id: string;
  level: "risk" | "watch" | "info";
  title: string;
  text: string;
  initiativeId?: string;
  department?: Department;
  perspective: "Initiative" | "Department" | "Distributor";
  rule: string;
}
export interface Totals {
  budget: number;
  allocated: number;
  pool: number;
  count: number;
  completed: number;
}
export interface TrackingSummary {
  budget: number;
  allocated: number;
  pool: number;
  actual: number;
  remaining: number;
  utilization: number | null;
  forecast: number | null;
  variance: number | null;
  missing: number;
}
