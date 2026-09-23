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
import * as api from "./api.js";

export const STORAGE_KEY = "shell-resource-workbench-v13";
const demoMode = import.meta.env.VITE_DATA_MODE === "demo";

export const roles = E.DEPARTMENTS.flatMap((department) => [
  ...[1, 2].map((number) => ({
    key: `owner-${department}-${number}`,
    role: "owner",
    department,
    ownerId: `${department}-${number}`,
    label: `${department} · Marketer ${number}`,
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
const blankDepartments = () =>
  Object.fromEntries(
    E.DEPARTMENTS.map((id) => [
      id,
      { id, status: "collecting", versions: [], comments: [] },
    ]),
  );
const blankState = () => ({
  schemaVersion: 2,
  scenario: "api",
  initiatives: [],
  departments: blankDepartments(),
  reference: { batchId: "—", asOf: "—" },
  guide: { version: 1, text: "" },
  insights: {},
  analysisPrompts: {},
  budgetReasons: [],
  budgetReasonVersion: 1,
  publications: {},
  audit: [],
  final: null,
  configRevision: 1,
});

function loadDemo() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return E.migrateState(JSON.parse(saved));
  } catch (_) {
    /* Fresh demo remains safe. */
  }
  return E.createState(DATA, "unallocated");
}

function normalizeWorkspace(payload) {
  const incoming = payload.state || payload.data?.state || blankState();
  const state = {
    ...blankState(),
    ...incoming,
    departments: { ...blankDepartments(), ...(incoming.departments || {}) },
    initiatives: incoming.initiatives || payload.data?.initiatives || [],
    publications: incoming.publications || {},
    audit: incoming.audit || [],
  };
  state.initiatives = state.initiatives.map((item) => ({
    ...item,
    id: String(item.id),
    rows: item.rows || [],
    otherBudgets: item.otherBudgets || [],
    revision: Number(item.revision || 0),
    status: item.status || "draft",
  }));
  const identity = payload.identity && {
    ...payload.identity,
    apiMode: true,
    ownerId: payload.identity.ownerId || payload.identity.email,
  };
  return {
    state,
    identity,
    users: payload.users || [],
    data: { ...(payload.data || {}), dealers: payload.data?.dealers || [] },
  };
}

export function mergeSavedDraft(state, id, saved, requested) {
  const current = state.initiatives.find((item) => item.id === String(id));
  const edited = JSON.stringify(current) !== JSON.stringify(requested);
  const next = structuredClone(state);
  const index = next.initiatives.findIndex((item) => item.id === String(id));
  if (index >= 0 && !edited)
    next.initiatives[index] = { ...current, ...saved, id: String(id) };
  if (index >= 0 && edited)
    next.initiatives[index].revision = Math.max(
      current.revision,
      saved.revision + 1,
    );
  return { next, edited };
}

const Context = createContext(null);

export function WorkbenchProvider({ children }) {
  const [state, setState] = useState(demoMode ? loadDemo : blankState);
  const [data, setData] = useState(demoMode ? DATA : { dealers: [] });
  const [identity, setIdentityState] = useState(demoMode ? roles[0] : null);
  const [users, setUsers] = useState([]);
  const [serverRevisions, setServerRevisions] = useState({});
  const [dirtyIds, setDirtyIds] = useState(new Set());
  const [devEmail, setDevEmailState] = useState(
    demoMode ? "" : api.getDevelopmentEmail(),
  );
  const [loading, setLoading] = useState(!demoMode);
  const [storageWarning, setStorageWarning] = useState("");
  const [page, setPage] = useState("home");
  const [initiativeId, setInitiativeId] = useState("");
  const [annotation, setAnnotation] = useState(false);
  const [toast, setToast] = useState(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [rawRequest, setRawRequest] = useState(null);
  const [scenarioEpoch, setScenarioEpoch] = useState(0);
  const [auxiliary, setAuxiliary] = useState({
    open: false,
    tab: "reference",
    dealerId: "",
    scope: "",
  });
  const stateRef = useRef(state);
  const returnFocus = useRef(null);
  const sessionEpoch = useRef(0);
  const pendingDrafts = useRef(new Set());

  const replaceState = (next) => {
    stateRef.current = next;
    setState(next);
  };
  const notify = (message, error = false) =>
    setToast({ message, error, id: Date.now() });
  const view = useMemo(
    () =>
      identity
        ? E.selectView(state, identity)
        : { initiatives: [], departments: {}, summaries: {} },
    [identity, state],
  );

  const clearApiWorkspace = () => {
    sessionEpoch.current += 1;
    pendingDrafts.current.clear();
    replaceState(blankState());
    setData({ dealers: [] });
    setIdentityState(null);
    setUsers([]);
    setServerRevisions({});
    setDirtyIds(new Set());
    setInitiativeId("");
    setRawRequest(null);
    setAuxiliary({ open: false, tab: "reference", dealerId: "", scope: "" });
  };

  const refresh = async () => {
    if (demoMode) return true;
    const epoch = ++sessionEpoch.current;
    pendingDrafts.current.clear();
    setLoading(true);
    setStorageWarning("");
    try {
      const workspace = normalizeWorkspace(await api.workspace());
      if (epoch !== sessionEpoch.current) return false;
      replaceState(workspace.state);
      setData(workspace.data);
      setIdentityState(workspace.identity);
      setUsers(workspace.users);
      setServerRevisions(
        Object.fromEntries(
          workspace.state.initiatives.map((item) => [item.id, item.revision]),
        ),
      );
      setDirtyIds(new Set());
      setPage(homeFor(workspace.identity));
      return true;
    } catch (error) {
      if (epoch !== sessionEpoch.current) return false;
      setLoading(false);
      clearApiWorkspace();
      setStorageWarning(error.message || "工作台加载失败，请重试。");
      return false;
    } finally {
      if (epoch === sessionEpoch.current) setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  const inputReady = () => {
    const invalid = document.querySelector('[data-unsaved-invalid="true"]');
    if (!invalid) return true;
    notify("请先修正当前输入，再继续操作。", true);
    invalid.matches("input,textarea")
      ? invalid.focus()
      : invalid.querySelector("input,textarea")?.focus();
    return false;
  };

  const mutate = (change, message) => {
    try {
      const before = stateRef.current;
      const next = structuredClone(before);
      change(next);
      replaceState(next);
      const changed = next.initiatives
        .filter(
          (item) =>
            JSON.stringify(item) !==
            JSON.stringify(
              before.initiatives.find((row) => row.id === item.id),
            ),
        )
        .map((item) => item.id);
      if (!demoMode && changed.length)
        setDirtyIds((old) => new Set([...old, ...changed]));
      if (demoMode) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      if (message) notify(message);
      return true;
    } catch (error) {
      notify(error.message || "操作未完成，请重试。", true);
      return false;
    }
  };

  // Keep edits made while a save is in flight. Only the server revision advances.
  const acceptSavedDraft = (id, saved, requested) => {
    const { next, edited } = mergeSavedDraft(
      stateRef.current,
      id,
      saved,
      requested,
    );
    replaceState(next);
    setServerRevisions((old) => ({ ...old, [id]: saved.revision }));
    if (!edited)
      setDirtyIds((old) => {
        const clean = new Set(old);
        clean.delete(String(id));
        return clean;
      });
  };

  const saveDraft = async (id, values, expectedRevision) => {
    const current = stateRef.current.initiatives.find(
      (item) => item.id === String(id),
    );
    const draft = values ? { ...current, ...values } : current;
    if (!draft || pendingDrafts.current.has(String(id))) return false;
    const epoch = sessionEpoch.current;
    const requested = structuredClone(current);
    pendingDrafts.current.add(String(id));
    try {
      if (demoMode) {
        E.updateInitiative(
          stateRef.current,
          id,
          { rows: draft.rows, otherBudgets: draft.otherBudgets },
          identity,
          data,
        );
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stateRef.current));
        replaceState(structuredClone(stateRef.current));
        notify("草稿已保存。");
        return true;
      }
      const result = await api.saveDraft(
        id,
        draft,
        expectedRevision ?? serverRevisions[id],
      );
      if (epoch !== sessionEpoch.current) return false;
      const saved = result.initiative || result;
      acceptSavedDraft(id, saved, requested);
      notify("草稿已保存。");
      return true;
    } catch (error) {
      if (epoch !== sessionEpoch.current) return false;
      notify(
        error.status === 409
          ? "草稿已被其他人更新；当前编辑仍保留，请刷新后处理。"
          : error.message || "草稿保存失败，请重试。",
        true,
      );
      return false;
    } finally {
      if (epoch === sessionEpoch.current)
        pendingDrafts.current.delete(String(id));
    }
  };

  const publish = async (id) => {
    const local = stateRef.current.initiatives.find(
      (item) => item.id === String(id),
    );
    if (!local || pendingDrafts.current.has(String(id))) return false;
    const epoch = sessionEpoch.current;
    const requested = structuredClone(local);
    if (!demoMode) pendingDrafts.current.add(String(id));
    try {
      if (demoMode) {
        const draftSaved = await saveDraft(id);
        if (!draftSaved) return false;
        const publication = E.publishInitiative(
          stateRef.current,
          id,
          identity,
          data,
        );
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stateRef.current));
        replaceState(structuredClone(stateRef.current));
        notify("已同步最新分配，仍可继续修改。");
        return publication;
      }
      const saved = await api.saveDraft(id, requested, serverRevisions[id]);
      if (epoch !== sessionEpoch.current) return false;
      const draft = saved.initiative || saved;
      acceptSavedDraft(id, draft, requested);
      // Saving is durable even when the following synchronization fails validation.
      const publication = await api.publish(id, draft);
      if (epoch !== sessionEpoch.current) return false;
      const next = structuredClone(stateRef.current);
      const history = next.publications[id] || [];
      next.publications[id] = [
        ...history.filter((item) => item.id !== publication.id),
        publication,
      ];
      const current = next.initiatives.find((item) => item.id === String(id));
      if (current) {
        current.publishedRevision =
          publication.publishedRevision ?? draft.revision;
        current.publishedAt = publication.publishedAt;
      }
      replaceState(next);
      notify("已同步最新分配，仍可继续修改。");
      return publication;
    } catch (error) {
      if (epoch !== sessionEpoch.current) return false;
      notify(
        error.status === 409
          ? "草稿已被其他人更新；当前编辑仍保留，请刷新后处理。"
          : error.message || "同步失败，请重试。",
        true,
      );
      return false;
    } finally {
      if (epoch === sessionEpoch.current)
        pendingDrafts.current.delete(String(id));
    }
  };

  const saveAdminBudgets = async (items) => {
    const epoch = sessionEpoch.current;
    try {
      await api.updateBudgets(items);
      if (epoch !== sessionEpoch.current) return false;
      return await refresh();
    } catch (error) {
      if (epoch !== sessionEpoch.current) return false;
      notify(error.message || "预算配置保存失败，请重试。", true);
      return false;
    }
  };
  const saveConfig = async (value) => {
    const epoch = sessionEpoch.current;
    try {
      const result = await api.updateConfig({
        expected_revision: stateRef.current.configRevision,
        ...value,
      });
      if (epoch !== sessionEpoch.current) return false;
      const next = {
        ...stateRef.current,
        ...result,
        configRevision:
          result.revision ??
          result.configRevision ??
          stateRef.current.configRevision,
      };
      replaceState(next);
      notify("配置已保存。");
      return true;
    } catch (error) {
      if (epoch !== sessionEpoch.current) return false;
      notify(error.message || "配置保存失败，请重试。", true);
      return false;
    }
  };
  const saveReference = async (value) => {
    const epoch = sessionEpoch.current;
    try {
      await api.uploadReference({
        expected_revision: stateRef.current.configRevision,
        ...value,
      });
      if (epoch !== sessionEpoch.current) return false;
      return await refresh();
    } catch (error) {
      if (epoch !== sessionEpoch.current) return false;
      notify(error.message || "历史参考导入失败，请重试。", true);
      return false;
    }
  };

  const setDevelopmentEmail = async (email) => {
    if (demoMode) return;
    api.setDevelopmentEmail(email);
    setDevEmailState(api.getDevelopmentEmail());
    clearApiWorkspace();
    if (!api.getDevelopmentEmail()) {
      setLoading(false);
      setStorageWarning("");
      return;
    }
    await refresh();
  };
  const navigate = (nextPage, id) => {
    if (!inputReady()) return false;
    if (
      nextPage === "editor" &&
      !view.initiatives.some((item) => item.id === id)
    )
      return false;
    setPage(nextPage);
    if (id) setInitiativeId(id);
    setMobileNav(false);
    return true;
  };
  const setIdentity = (next) => {
    if (!demoMode) return false;
    const chosen =
      typeof next === "string" ? roles.find((role) => role.key === next) : next;
    if (!chosen || !inputReady()) return false;
    setIdentityState(chosen);
    setPage(homeFor(chosen));
    setInitiativeId("");
    setRawRequest(null);
    setAuxiliary({
      open: chosen.role === "lead",
      tab: "insight",
      dealerId: "",
      scope: chosen.department || "global",
    });
    return true;
  };
  const openAuxiliary = (tab, selection) => {
    returnFocus.current = document.activeElement;
    setAuxiliary((current) => ({
      ...current,
      open: true,
      tab,
      ...(tab === "reference" && selection
        ? { dealerId: String(selection) }
        : {}),
      ...(tab === "insight" ? { scope: selection || "" } : {}),
    }));
  };
  const closeAuxiliary = () => {
    setAuxiliary((current) => ({ ...current, open: false }));
    requestAnimationFrame(
      () => returnFocus.current?.isConnected && returnFocus.current.focus(),
    );
  };
  const openRaw = (tab = "history", search = "") => {
    if (navigate("raw")) setRawRequest({ tab, search, id: Date.now() });
  };
  const resetScenario = (scenario) => {
    if (!demoMode) return;
    const next = E.createState(DATA, scenario);
    replaceState(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setScenarioEpoch((value) => value + 1);
    notify("已切换演示场景。");
  };

  const value = {
    state,
    data,
    identity,
    roles: demoMode ? roles : users,
    apiMode: !demoMode,
    devEmail,
    setDevelopmentEmail,
    loading,
    refresh,
    dirtyIds,
    serverRevisions,
    setIdentity,
    view,
    page,
    navigate,
    initiativeId,
    mutate,
    saveDraft,
    publish,
    saveAdminBudgets,
    saveConfig,
    saveReference,
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
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useWorkbench() {
  const context = useContext(Context);
  if (!context) throw new Error("WorkbenchProvider missing");
  return context;
}
