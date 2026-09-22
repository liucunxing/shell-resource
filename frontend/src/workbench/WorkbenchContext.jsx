import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import E from "./domain/engine.js";
import DATA from "./domain/demo-data.json";

export const STORAGE_KEY = "shell-resource-workbench-v13";
const PROTOTYPE_KEY = "resource-workbench-v13-20260919";
export const roles = E.DEPARTMENTS.flatMap((department) => [
  ...[1, 2].map((n) => ({
    key: `owner-${department}-${n}`,
    role: "owner",
    department,
    ownerId: `${department}-${n}`,
    label: `${department} · Marketer ${n}`,
  })),
  {
    key: `lead-${department}`,
    role: "lead",
    department,
    label: `${department} · 部门负责人`,
  },
]).concat([
  { key: "management", role: "management", label: "管理层 · 只读统览" },
  { key: "admin", role: "admin", label: "管理员 · 数据与配置" },
]);
const homeFor = (identity) =>
  identity.role === "owner"
    ? "home"
    : identity.role === "lead"
      ? "department"
      : identity.role === "admin"
        ? "admin"
        : "management";
function loadWorkspace() {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) || localStorage.getItem(PROTOTYPE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (
        [1, 2].includes(saved.schemaVersion) &&
        saved.initiatives?.length === DATA.initiatives.length &&
        saved.departments?.ICE
      ) {
        return { state: E.migrateState(saved), warning: "" };
      }
      return {
        state: E.createState(DATA, "unallocated"),
        warning: "已有记录与新版结构不匹配，已保留原记录并载入演示数据。",
      };
    }
    return { state: E.createState(DATA, "unallocated"), warning: "" };
  } catch {
    return {
      state: E.createState(DATA, "unallocated"),
      warning: "本机记录无法读取，当前使用演示数据；原记录未覆盖。",
    };
  }
}
const Context = createContext(null);
export function WorkbenchProvider({ children }) {
  const [loaded] = useState(loadWorkspace);
  const [state, setState] = useState(loaded.state);
  const stateRef = useRef(state);
  const [identity, setCurrentIdentity] = useState(roles[0]);
  const [page, setPage] = useState("home");
  const [initiativeId, setInitiativeId] = useState("");
  const [annotation, setAnnotation] = useState(false);
  const [storageWarning, setStorageWarning] = useState(loaded.warning);
  const [toast, setToast] = useState(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [rawRequest, setRawRequest] = useState(null);
  const [scenarioEpoch, setScenarioEpoch] = useState(0);
  const [auxiliary, setAuxiliary] = useState({
    open: false,
    tab: "reference",
    dealerId: "",
    scope: "",
    wide: false,
  });
  const returnFocus = useRef(null);
  const view = useMemo(() => E.selectView(state, identity), [state, identity]);
  const notify = (message, error = false) =>
    setToast({ message, error, id: Date.now() });
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  const inputReady = () => {
    const invalid = document.querySelector('[data-unsaved-invalid="true"]');
    if (!invalid) return true;
    notify("请先修正当前输入，再继续操作。", true);
    (invalid.matches("input,textarea")
      ? invalid
      : invalid.querySelector("input,textarea")
    )?.focus();
    return false;
  };
  const save = (next) => {
    stateRef.current = next;
    setState(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setStorageWarning("");
    } catch {
      setStorageWarning(
        "浏览器无法保存本次操作；当前会话仍可使用，刷新可能丢失修改。",
      );
    }
  };
  const mutate = (fn, message) => {
    try {
      const next = structuredClone(stateRef.current);
      fn(next);
      save(next);
      if (message) notify(message);
      return true;
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "操作未完成，请重试。",
        true,
      );
      return false;
    }
  };
  const navigate = (nextPage, id) => {
    if (!inputReady()) return false;
    if (
      nextPage === "editor" &&
      !view.initiatives.some((item) => item.id === id)
    ) {
      notify("当前角色无法查看这项 Initiative。", true);
      return false;
    }
    setPage(nextPage);
    if (id) setInitiativeId(id);
    setMobileNav(false);
    setAuxiliary((value) => ({
      ...value,
      scope: "",
      open: value.wide || window.innerWidth < 1200 ? false : value.open,
    }));
    requestAnimationFrame(() =>
      document.getElementById("main")?.focus({ preventScroll: true }),
    );
    return true;
  };
  const setIdentity = (next) => {
    if (!inputReady()) return false;
    const chosen =
      typeof next === "string" ? roles.find((role) => role.key === next) : next;
    if (!chosen || !roles.some((role) => role.key === chosen.key)) return false;
    setCurrentIdentity(chosen);
    setPage(homeFor(chosen));
    setInitiativeId("");
    setMobileNav(false);
    setRawRequest(null);
    setAuxiliary({
      open: chosen.role === "lead",
      tab: "insight",
      dealerId: "",
      scope: chosen.department || "global",
      wide: false,
    });
    requestAnimationFrame(() =>
      document.getElementById("main")?.focus({ preventScroll: true }),
    );
    return true;
  };
  const openAuxiliary = (tab, selection) => {
    returnFocus.current = document.activeElement;
    setMobileNav(false);
    setAuxiliary((value) => ({
      ...value,
      open: true,
      tab,
      wide: tab === "chat" ? true : value.wide,
      ...(tab === "reference" && selection
        ? { dealerId: String(selection) }
        : {}),
      ...(tab === "insight" ? { scope: selection || "" } : {}),
    }));
  };
  const closeAuxiliary = () => {
    setAuxiliary((value) => ({ ...value, open: false }));
    requestAnimationFrame(() => {
      const target = returnFocus.current;
      if (
        target?.isConnected &&
        !target.closest("[inert]") &&
        !target.closest(".work-content")
      )
        target.focus();
      else
        document.querySelector(`[data-work-tab="${auxiliary.tab}"]`)?.focus();
    });
  };
  const openRaw = (tab = "history", search = "") => {
    if (navigate("raw")) setRawRequest({ tab, search, id: Date.now() });
  };
  const resetScenario = (scenario) => {
    save(E.createState(DATA, scenario));
    setScenarioEpoch((value) => value + 1);
    setRawRequest(null);
    setInitiativeId("");
    setPage(homeFor(identity));
    setAuxiliary({
      open: false,
      tab: "reference",
      dealerId: "",
      scope: "",
      wide: false,
    });
    notify("已切换演示场景。");
  };
  return (
    <Context.Provider
      value={{
        state,
        data: DATA,
        identity,
        roles,
        setIdentity,
        view,
        page,
        navigate,
        initiativeId,
        mutate,
        notify,
        toast,
        dismissToast: () => setToast(null),
        storageWarning,
        annotation,
        setAnnotation,
        auxiliary,
        setAuxiliary,
        openAuxiliary,
        closeAuxiliary,
        mobileNav,
        setMobileNav,
        rawRequest,
        openRaw,
        resetScenario,
        scenarioEpoch,
        inputReady,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useWorkbench() {
  const context = useContext(Context);
  if (!context) throw new Error("WorkbenchProvider missing");
  return context;
}
