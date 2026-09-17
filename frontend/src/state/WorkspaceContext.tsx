import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { Department, Page, WorkspaceState } from "../domain/types";
import { createDemoState } from "../domain/demo";
import { makeId } from "../domain/engine";

const STORAGE_KEY = "shell-resource-workspace-v1";
const PAGES: Page[] = [
  "home",
  "database",
  "allocation",
  "adjust",
  "submit",
  "tracking",
];
export interface Toast {
  id: string;
  message: string;
  kind: "success" | "error" | "info";
}
interface WorkspaceContextValue {
  state: WorkspaceState;
  department: Department;
  setDepartment: (department: Department) => void;
  page: Page;
  navigate: (page: Page) => void;
  run: (
    transform: (state: WorkspaceState) => WorkspaceState,
    label: string,
  ) => boolean;
  notify: (message: string, kind?: Toast["kind"]) => void;
  toast: Toast | null;
  dismissToast: () => void;
  persistenceError: string | null;
}
const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
function load(): { state: WorkspaceState; error: string | null } {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { state: createDemoState(), error: null };
    const parsed = JSON.parse(raw) as WorkspaceState;
    if (
      parsed.schemaVersion !== 1 ||
      !Array.isArray(parsed.budgets) ||
      !Array.isArray(parsed.allocations) ||
      !Array.isArray(parsed.versions) ||
      !Array.isArray(parsed.audit) ||
      !Array.isArray(parsed.history) ||
      !Array.isArray(parsed.forecast) ||
      !Array.isArray(parsed.applicable) ||
      !Array.isArray(parsed.tracking) ||
      !parsed.confirmed
    )
      throw new Error("格式不兼容");
    return { state: parsed, error: null };
  } catch {
    if (raw) {
      try {
        localStorage.setItem(`${STORAGE_KEY}-recovery-${Date.now()}`, raw);
      } catch {
        return {
          state: createDemoState(),
          error:
            "本机数据无法读取且无法备份。当前展示临时示例，存储被保护；导出所需数据后再清空或恢复工作区。",
        };
      }
    }
    return {
      state: createDemoState(),
      error: raw
        ? "本机数据格式异常，原始内容已备份至本机 recovery 记录。当前展示示例数据。"
        : "浏览器存储不可用，当前展示示例数据。",
    };
  }
}
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(load);
  const [state, setState] = useState(initial.state);
  const current = useRef(state);
  const storageProtected = useRef(
    Boolean(initial.error?.includes("存储被保护")),
  );
  const [department, setDepartment] = useState<Department>("MKT");
  const [page, setPage] = useState<Page>(
    () => PAGES.find((p) => `#${p}` === location.hash) ?? "home",
  );
  const [toast, setToast] = useState<Toast | null>(null);
  const [persistenceError, setPersistenceError] = useState(initial.error);
  const notify = useCallback(
    (message: string, kind: Toast["kind"] = "success") =>
      setToast({ id: makeId(), message, kind }),
    [],
  );
  useEffect(() => {
    const listener = () =>
      setPage(PAGES.find((p) => `#${p}` === location.hash) ?? "home");
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  useEffect(() => {
    if (!toast || toast.kind === "error") return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);
  const navigate = useCallback((next: Page) => {
    location.hash = next;
    setPage(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);
  const run = useCallback(
    (transform: (state: WorkspaceState) => WorkspaceState, label: string) => {
      try {
        const next = transform(structuredClone(current.current));
        next.updatedAt = new Date().toISOString();
        next.audit = [
          { id: makeId(), time: next.updatedAt, text: label },
          ...next.audit,
        ].slice(0, 100);
        try {
          if (label.includes("已恢复合成示例") || label.includes("已清空本机"))
            storageProtected.current = false;
          if (storageProtected.current) throw new Error("protected");
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
          setPersistenceError(null);
        } catch {
          setPersistenceError(
            "浏览器存储不可用，修改仅在本次会话保留。请导出数据备份。",
          );
        }
        current.current = next;
        setState(next);
        notify(label);
        return true;
      } catch (error) {
        notify(
          error instanceof Error ? error.message : "操作未完成，请检查输入",
          "error",
        );
        return false;
      }
    },
    [notify, initial.error],
  );
  return (
    <WorkspaceContext.Provider
      value={{
        state,
        department,
        setDepartment,
        page,
        navigate,
        run,
        notify,
        toast,
        dismissToast: () => setToast(null),
        persistenceError,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}
export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("WorkspaceProvider is required");
  return context;
}
