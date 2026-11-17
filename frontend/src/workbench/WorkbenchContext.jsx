import { LegendColorProvider } from "./LegendColors";
import {
  useCallback,
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
import { isPortalEntry, logoutPortalSession } from "../portal/session";
import { getPreviewEpoch, getPreviewUserEmail, setPreviewUserEmail } from "./userPreview";

export const STORAGE_KEY = "shell-resource-workbench-v13";
export const ownInitiatives = (items, identity) => {
  const owner = String(identity?.ownerId || identity?.email || "").toLowerCase();
  return owner ? items.filter((item) => String(item.ownerId || "").toLowerCase() === owner) : [];
};
export function resolveEditorTarget(requestedId, previousId, initiatives, options = {}) {
  const find = (id) => initiatives.find((item) => String(item.id) === String(id));
  if (requestedId != null && requestedId !== "") return find(requestedId)?.id ?? null;
  const stamp = (item) => Date.parse(item.savedAt) || 0;
  const latest = (items) => items.reduce((chosen, item) =>
    !chosen || stamp(item) > stamp(chosen) ||
    (stamp(item) === stamp(chosen) && item.id === previousId) ? item : chosen, null);
  const drafts = initiatives.filter((item) => {
    if (options.canEdit && !options.canEdit(item)) return false;
    if (item.workflow?.editable === false) return false;
    if (options.dirtyIds?.has(item.id)) return true;
    return item.workflow ? !item.workflow.submitted : item.status !== "completed";
  });
  return (latest(drafts) || find(previousId) || latest(initiatives))?.id ?? null;
}
const portalMode = isPortalEntry();
const demoMode = !portalMode && import.meta.env.VITE_DATA_MODE === "demo";
if (!demoMode && !portalMode) api.acceptPortalEmail();

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
        ? "admin-versions"
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

export function normalizeWorkspace(payload) {
  const incoming = payload.state || payload.data?.state || blankState();
  const state = {
    ...blankState(),
    ...incoming,
    departments: { ...blankDepartments(), ...(incoming.departments || {}) },
    initiatives: incoming.initiatives || payload.data?.initiatives || [],
    publications: incoming.publications || {},
    audit: incoming.audit || [],
  };
  for (const dep of new Set([...E.departments(payload.identity), ...state.initiatives.map((item) => item.department)])) {
    state.departments[dep] ||= { id: dep, status: "collecting", versions: [], comments: [] };
  }
  state.initiatives = state.initiatives.map((item) => ({
    ...item,
    id: String(item.id),
    rows: item.rows || [],
    otherBudgets: item.otherBudgets || [],
    revision: Number(item.revision || 0),
    status: item.status || "draft",
  }));
  if (payload.identity?.role === "lead" && state.planningVersion) {
    state.departmentInitiatives = state.initiatives;
    const drafts = new Map((incoming.ownInitiatives || []).map((item) => [String(item.id), {
      ...item, id: String(item.id), rows: item.rows || [], otherBudgets: item.otherBudgets || [],
      revision: Number(item.revision || 0), status: item.status || "draft",
    }]));
    state.initiatives = state.initiatives.map((item) => drafts.get(item.id) || item);
  }
  const identity = payload.identity && {
    ...payload.identity,
    apiMode: true,
    department: E.departments(payload.identity),
    ownerId: payload.identity.ownerId || payload.identity.email,
  };
  return {
    state,
    identity,
    users: payload.users || [],
    data: {
      ...(payload.data || {}),
      dealers: payload.data?.dealers || [],
      distributorDirectory: [],
    },
  };
}

export function selectWorkspaceView(state, identity, page) {
  if (!identity) return { initiatives: [], departments: {}, summaries: {} };
  const selected = E.selectView(state, identity);
  let items = state.planningVersion
    ? state.initiatives.filter((item) => identity.role === "admin" || item.enabled !== false)
    : selected.initiatives;
  if (identity.role === "lead") {
    if (["home", "editor", "portfolio", "submissions"].includes(page)) items = ownInitiatives(items, identity);
    else if (state.departmentInitiatives) items = state.departmentInitiatives.filter((item) => item.enabled !== false);
  }
  return { ...selected, initiatives: items };
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

export async function changePlanningVersion({ id, currentId, targetPage, setPage, setVersion, refresh }) {
  if (String(id) === String(currentId || "")) {
    if (targetPage) setPage(targetPage);
    return true;
  }
  setVersion(id);
  return refresh({ targetPage, expectedVersionId: id });
}

const Context = createContext(null);

export function WorkbenchProvider({ children }) {
  const [state, setState] = useState(demoMode ? loadDemo : blankState);
  const [data, setData] = useState(
    demoMode ? DATA : { dealers: [], distributorDirectory: [] },
  );
  const [identity, setIdentityState] = useState(demoMode ? roles[0] : null);
  const [previewActor, setPreviewActor] = useState(null);
  const [switchingPreview, setSwitchingPreview] = useState(false);
  const previewSwitch = useRef(false);
  const [users, setUsers] = useState([]);
  const [serverRevisions, setServerRevisions] = useState({});
  const [dirtyIds, setDirtyIds] = useState(new Set());
  const [savedForSyncIds, setSavedForSyncIds] = useState(new Set());
  const [editorOperations, setEditorOperations] = useState({});
  const [devEmail, setDevEmailState] = useState(
    demoMode || portalMode ? "" : api.getDevelopmentEmail(),
  );
  const [loading, setLoading] = useState(!demoMode);
  const [storageWarning, setStorageWarning] = useState("");
  const [page, setPage] = useState("home");
  const [initiativeId, setInitiativeId] = useState("");
  const [toast, setToast] = useState(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [rawRequest, setRawRequest] = useState(null);
  const [scenarioEpoch, setScenarioEpoch] = useState(0);
  const stateRef = useRef(state);
  const sessionEpoch = useRef(0);
  const pendingDrafts = useRef(new Set());
  const directoryLoaded = useRef(demoMode);
  const directoryRequest = useRef(null);
  const directoryRows = useRef(demoMode ? DATA.dealers : []);
  const [directoryStatus, setDirectoryStatus] = useState(
    demoMode ? "ready" : "idle",
  );

  const replaceState = (next) => {
    stateRef.current = next;
    setState(next);
  };
  const notify = (message, error = false) =>
    setToast({ message, error, id: Date.now() });
  const view = useMemo(() => selectWorkspaceView(state, identity, page), [identity, state, page]);

  const clearApiWorkspace = () => {
    sessionEpoch.current += 1;
    pendingDrafts.current.clear();
    replaceState(blankState());
    setData({ dealers: [], distributorDirectory: [] });
    directoryRows.current = [];
    directoryLoaded.current = demoMode;
    directoryRequest.current = null;
    setDirectoryStatus(demoMode ? "ready" : "idle");
    setIdentityState(null);
    setUsers([]);
    setServerRevisions({});
    setDirtyIds(new Set());
    setSavedForSyncIds(new Set());
    setEditorOperations({});
    setInitiativeId("");
    setRawRequest(null);
    setToast(null);
    setMobileNav(false);
    setScenarioEpoch((value) => value + 1);
  };

  const refresh = async (options = {}) => {
    if (demoMode) return true;
    const epoch = ++sessionEpoch.current;
    pendingDrafts.current.clear();
    setLoading(true);
    directoryLoaded.current = demoMode;
    directoryRequest.current = null;
    setDirectoryStatus(demoMode ? "ready" : "idle");
    setStorageWarning("");
    try {
      const workspace = normalizeWorkspace(await api.workspace());
      if (epoch !== sessionEpoch.current) return false;
      if (options.expectedVersionId && String(workspace.state.currentVersionId || workspace.state.planningVersion?.id || "") !== String(options.expectedVersionId))
        throw Error("所选规划版本加载失败，请刷新后重试。");
      const previewEmail = getPreviewUserEmail();
      const workspaceEmail = String(workspace.identity?.email || "").trim().toLowerCase();
      if (previewEmail && (workspaceEmail !== previewEmail ||
          workspace.identity?.preview?.readOnly !== true))
        throw Error("服务暂不支持模拟查看，请返回管理员。");
      replaceState(workspace.state);
      setData(workspace.data);
      directoryRows.current = [];
      setIdentityState(workspace.identity);
      setUsers(workspace.users);
      setServerRevisions(
        Object.fromEntries(
          workspace.state.initiatives.map((item) => [item.id, item.revision]),
        ),
      );
      setDirtyIds(new Set());
      setSavedForSyncIds(new Set());
      setEditorOperations({});
      api.setPlanningVersion(workspace.state.currentVersionId || workspace.state.planningVersion?.id || "");
      if (options.targetPage) setPage(options.targetPage);
      else if (!options.preservePage) setPage(homeFor(workspace.identity));
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

  const selectPlanningVersion = async (id, options = {}) => {
    if (!inputReady()) return false;
    if (dirtyIds.size) {
      notify("请先保存当前草稿，再切换规划版本。", true);
      return false;
    }
    setInitiativeId("");
    return changePlanningVersion({ id, currentId: stateRef.current.currentVersionId || stateRef.current.planningVersion?.id, targetPage: options.targetPage, setPage, setVersion: api.setPlanningVersion, refresh: (args) => refresh({ ...args, preservePage: page !== "editor" }) });
  };

  const refreshPlanningVersions = async () => {
    if (demoMode) return true;
    const epoch = sessionEpoch.current;
    const versions = await api.planningVersions();
    if (epoch !== sessionEpoch.current) return false;
    const current = stateRef.current.planningVersion;
    const latest = versions.find((version) => version.id === current?.id);
    // A concurrent change to the loaded version can affect workflow/permissions.
    // Only skip its full reload when its revision is still current.
    if (!current || !latest || latest.revision !== current.revision)
      return refresh({ preservePage: true });
    replaceState({ ...stateRef.current, planningVersions: versions, planningVersion: latest });
    return true;
  };

  const loadDistributorDirectory = useCallback(async ({ force = false } = {}) => {
    if (demoMode) return directoryRows.current;
    if (directoryLoaded.current && !force) return directoryRows.current;
    if (directoryRequest.current && !force) return directoryRequest.current;
    const epoch = sessionEpoch.current;
    setDirectoryStatus("loading");
    const request = (async () => {
      try {
        const dealers = await api.distributors();
        if (epoch !== sessionEpoch.current) return false;
        const directory = Array.isArray(dealers) ? dealers : [];
        setData((current) => ({
          ...current,
          distributorDirectory: directory,
        }));
        directoryRows.current = directory;
        directoryLoaded.current = true;
        setDirectoryStatus("ready");
        return directory;
      } catch (_) {
        if (epoch !== sessionEpoch.current) return false;
        directoryLoaded.current = false;
        setDirectoryStatus("error");
        return false;
      } finally {
        if (directoryRequest.current === request) directoryRequest.current = null;
      }
    })();
    directoryRequest.current = request;
    return request;
  }, []);

  useEffect(() => {
    // The new Portal entry has already confirmed its server session. FineReport
    // still initializes from the existing email handoff before React mounts.
    if (demoMode) return;
    if (portalMode || api.getDevelopmentEmail()) refresh();
    else setLoading(false);
  }, []);
  useEffect(() => () => {
    sessionEpoch.current += 1;
    setPreviewUserEmail("");
  }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  const inputReady = () => {
    const invalid = document.querySelector('[data-unsaved-invalid="true"]');
    if (!invalid) return true;
    notify(invalid.dataset.invalidMessage || "请先修正当前输入，再继续操作。", true);
    invalid.matches("input,textarea")
      ? invalid.focus()
      : invalid.querySelector("input,textarea")?.focus();
    return false;
  };

  const mutate = (change, message) => {
    if (getPreviewUserEmail()) {
      notify("模拟查看为只读模式，请返回管理员后操作。", true);
      return false;
    }
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
      if (changed.length)
        setSavedForSyncIds((old) => {
          const next = new Set(old);
          changed.forEach((id) => next.delete(id));
          return next;
        });
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
    if (next.departmentInitiatives && saved.workflow) {
      next.departmentInitiatives = next.departmentInitiatives.map((item) =>
        item.id === String(id) ? { ...item, workflow: saved.workflow,
          allocationVisible: Boolean(saved.workflow.submitted),
          ...(!saved.workflow.submitted ? { rows: [], otherBudgets: [] } : {}) } : item);
    }
    replaceState(next);
    setServerRevisions((old) => ({ ...old, [id]: saved.revision }));
    if (!edited)
      setDirtyIds((old) => {
        const clean = new Set(old);
        clean.delete(String(id));
        return clean;
      });
    return !edited;
  };

  const saveDraft = async (id, values, expectedRevision, useLatestRevision = false) => {
    const current = stateRef.current.initiatives.find(
      (item) => item.id === String(id),
    );
    const draft = values ? { ...current, ...values } : current;
    if (!draft || pendingDrafts.current.has(String(id))) return false;
    const epoch = sessionEpoch.current;
    const requested = structuredClone(current);
    const showEditorOperation = values === undefined || Object.keys(values).every((key) => ["changeReason", "editorState"].includes(key));
    pendingDrafts.current.add(String(id));
    if (showEditorOperation)
      setEditorOperations((old) => ({ ...old, [id]: "save" }));
    try {
      if (demoMode) {
        E.updateInitiative(
          stateRef.current,
          id,
          { rows: draft.rows, otherBudgets: draft.otherBudgets,
            ...(draft.editorState !== undefined ? { editorState: draft.editorState } : {}) },
          identity,
          data,
        );
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stateRef.current));
        replaceState(structuredClone(stateRef.current));
        setSavedForSyncIds((old) => new Set([...old, String(id)]));
        notify("草稿已保存。");
        return true;
      }
      const latest = useLatestRevision ? await api.getDraft(id) : null;
      if (epoch !== sessionEpoch.current) return false;
      const result = await api.saveDraft(
        id,
        draft,
        latest ? latest.revision : expectedRevision ?? serverRevisions[id],
      );
      if (epoch !== sessionEpoch.current) return false;
      const saved = result.initiative || result;
      const unchanged = acceptSavedDraft(id, saved, requested);
      if (unchanged)
        setSavedForSyncIds((old) => new Set([...old, String(id)]));
      notify("草稿已保存。");
      return true;
    } catch (error) {
      if (epoch !== sessionEpoch.current) return false;
      setSavedForSyncIds((old) => {
        const next = new Set(old);
        next.delete(String(id));
        return next;
      });
      notify(
        error.status === 409
          ? "草稿已被其他人更新；当前编辑仍保留，请刷新后处理。"
          : error.message || "草稿保存失败，请重试。",
        true,
      );
      return false;
    } finally {
      if (epoch === sessionEpoch.current) {
        pendingDrafts.current.delete(String(id));
        if (showEditorOperation)
          setEditorOperations((old) => {
            const next = { ...old };
            delete next[id];
            return next;
          });
      }
    }
  };

  const publish = async (id, note = "") => {
    const local = stateRef.current.initiatives.find(
      (item) => item.id === String(id),
    );
    if (!local || pendingDrafts.current.has(String(id))) return false;
    const epoch = sessionEpoch.current;
    const requested = structuredClone(local);
    pendingDrafts.current.add(String(id));
    setEditorOperations((old) => ({ ...old, [id]: "publish" }));
    try {
      if (demoMode) {
        const publication = E.publishInitiative(
          stateRef.current,
          id,
          identity,
          data,
        );
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stateRef.current));
        replaceState(structuredClone(stateRef.current));
        setSavedForSyncIds((old) => {
          const next = new Set(old);
          next.delete(String(id));
          return next;
        });
        notify("已同步最新分配，仍可继续修改。");
        return publication;
      }
      let saved = requested;
      if (dirtyIds.has(String(id)) || requested.revision !== serverRevisions[id]) {
        const savedResult = await api.saveDraft(id, { ...requested, changeReason: note }, serverRevisions[id]);
        if (epoch !== sessionEpoch.current) return false;
        saved = savedResult.initiative || savedResult;
        acceptSavedDraft(id, saved, requested);
      }
      const publication = await api.publish(id, saved, note);
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
          publication.publishedRevision ?? requested.revision;
        current.publishedAt = publication.publishedAt;
        if (current.revision === saved.revision && publication.initiative?.changeReason !== undefined)
          current.changeReason = publication.initiative.changeReason;
      }
      replaceState(next);
      setSavedForSyncIds((old) => {
        const next = new Set(old);
        next.delete(String(id));
        return next;
      });
      if (current?.workflow) {
        current.workflow = publication.initiative?.workflow || { ...current.workflow, submitted: true, editable: true, requiresResubmission: false, returnReason: null };
        current.status = "completed";
        if (next.departmentInitiatives) {
          next.departmentInitiatives = next.departmentInitiatives.map((item) =>
            item.id === String(id) ? { ...item, ...publication.initiative,
              id: String(id), workflow: current.workflow, allocationVisible: true } : item);
        }
        replaceState({ ...next });
      }
      notify(current?.workflow ? "方案已提交，部门确认前仍可修改；修改后请再次提交。" : "已同步最新分配。");
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
      if (epoch === sessionEpoch.current) {
        pendingDrafts.current.delete(String(id));
        setEditorOperations((old) => {
          const next = { ...old };
          delete next[id];
          return next;
        });
      }
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
  const manageAdminBudget = async (action, item, payload) => {
    const epoch = sessionEpoch.current;
    try {
      if (stateRef.current.planningVersion) {
        const version = stateRef.current.planningVersion;
        const value = { ...payload, expected_revision: version.revision };
        delete value.id;
        if (action === "create") await api.createVersionInitiative(version.id, value);
        else if (action === "edit") await api.updateVersionInitiative(version.id, item.id, value);
        else throw Error("规划版本内请停用项目以保留历史。");
      }
      else if (action === "create") await api.createBudget(payload);
      else if (action === "edit") await api.editBudget(item.id, { ...payload, expected_revision: item.revision });
      else if (action === "delete") await api.deleteBudget(item.id, item.revision);
      else throw Error("项目操作无效");
      if (epoch !== sessionEpoch.current) return false;
      return await refresh({ preservePage: true });
    } catch (error) {
      if (epoch !== sessionEpoch.current) return false;
      notify(error.message || "项目配置保存失败，请重试。", true);
      throw error;
    }
  };
  const importAdminBudgets = async ({ updates, creates }) => {
    const epoch = sessionEpoch.current;
    try {
      await api.importBudgets(api.planningYear, updates, creates);
      if (epoch !== sessionEpoch.current) return false;
      return await refresh();
    } catch (error) {
      if (epoch !== sessionEpoch.current) return false;
      notify(error.message || "预算配置导入失败，请重试。", true);
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
      if (Object.hasOwn(value, "historyInvestmentExchangeRate")) {
        return await refresh({ preservePage: true });
      }
      notify("配置已保存。");
      return true;
    } catch (error) {
      if (epoch !== sessionEpoch.current) return false;
      notify(error.message || "配置保存失败，请重试。", true);
      return false;
    }
  };

  const setDevelopmentEmail = async (email) => {
    if (portalMode) {
      if (email) return;
      try {
        await logoutPortalSession();
        setPreviewUserEmail("");
        setPreviewActor(null);
        clearApiWorkspace();
      }
      catch { notify("退出未完成，请重试。", true); }
      return;
    }
    if (demoMode) return;
    setPreviewUserEmail("");
    setPreviewActor(null);
    api.setDevelopmentEmail(email);
    api.setPlanningVersion("");
    setDevEmailState(api.getDevelopmentEmail());
    clearApiWorkspace();
    if (!api.getDevelopmentEmail()) {
      setLoading(false);
      setStorageWarning("");
      return;
    }
    await refresh();
  };
  const startUserPreview = async (user) => {
    if (demoMode || identity?.role !== "admin" || getPreviewUserEmail() ||
        previewSwitch.current || !user?.enabled || user.email === identity.email || !inputReady()) return false;
    previewSwitch.current = true;
    setSwitchingPreview(true);
    setPreviewActor(identity);
    clearApiWorkspace();
    setPreviewUserEmail(user.email);
    const epoch = getPreviewEpoch();
    try {
      const ok = await refresh();
      if (epoch !== getPreviewEpoch()) return false;
      if (ok) return true;
      // Keep the administrator's credentials; reload its current permissions.
      setPreviewUserEmail("");
      setPreviewActor(null);
      await refresh();
      notify("模拟查看未能加载，该用户可能已停用或权限已变更。已退出模拟。", true);
      return false;
    } finally {
      previewSwitch.current = false;
      setSwitchingPreview(false);
    }
  };
  const stopUserPreview = async () => {
    if (previewSwitch.current) return false;
    previewSwitch.current = true;
    setSwitchingPreview(true);
    clearApiWorkspace();
    setPreviewUserEmail("");
    setPreviewActor(null);
    try { return await refresh(); }
    finally {
      previewSwitch.current = false;
      setSwitchingPreview(false);
    }
  };
  const navigate = (nextPage, id) => {
    if (!inputReady()) return false;
    if (nextPage === "editor") {
      const candidates = identity.role === "lead" ? ownInitiatives(stateRef.current.initiatives, identity) : view.initiatives;
      const targetId = resolveEditorTarget(id, initiativeId, candidates, {
        dirtyIds, canEdit: (item) => E.canEdit(stateRef.current, item.id, identity),
      });
      if (!targetId) {
        if (id) return false;
        setInitiativeId("");
        setPage("home");
        notify("当前版本没有可查看的 Initiative。");
        setMobileNav(false);
        return true;
      }
      setInitiativeId(targetId);
    }
    setPage(nextPage);
    if (id && nextPage !== "editor") setInitiativeId(id);
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
    return true;
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
    previewActor,
    previewMode: Boolean(identity?.preview?.readOnly || previewActor),
    switchingPreview,
    startUserPreview,
    stopUserPreview,
    roles: demoMode ? roles : users,
    apiMode: !demoMode,
    portalMode,
    devEmail,
    setDevelopmentEmail,
    loading,
    directoryStatus,
    loadDistributorDirectory,
    refresh,
    refreshPlanningVersions,
    selectPlanningVersion,
    dirtyIds,
    savedForSyncIds,
    editorOperations,
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
    manageAdminBudget,
    importAdminBudgets,
    saveConfig,
    notify,
    toast,
    dismissToast: () => setToast(null),
    storageWarning,
    mobileNav,
    setMobileNav,
    rawRequest,
    openRaw,
    resetScenario,
    scenarioEpoch,
    inputReady,
  };
  return <Context.Provider value={value}><LegendColorProvider colors={state.legendColors}>{children}</LegendColorProvider></Context.Provider>;
}

export function useWorkbench() {
  const context = useContext(Context);
  if (!context) throw new Error("WorkbenchProvider missing");
  return context;
}
