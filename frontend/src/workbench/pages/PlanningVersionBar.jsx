import { useWorkbench } from "../WorkbenchContext.jsx";

export function versionStatus(version) {
  if (!version) return "历史工作区";
  if (!version.published) return "未发布";
  if (!version.open) return "已关闭提交";
  if (version.deadline && new Date(version.deadline).getTime() <= Date.now()) return "已截止";
  return "开放提交";
}

export function PlanningVersionBar({ fixed = false }) {
  const { state, selectPlanningVersion, loading, apiMode } = useWorkbench();
  const versions = state.planningVersions || [];
  const current = state.planningVersion;
  return <div className="studio-version-bar">
    <label>规划版本
      {fixed ? <strong>{current ? `${current.id} · ${current.name}` : "当前历史工作区"}</strong> :
        <select aria-label="规划版本" value={current?.id || ""} disabled={loading || !apiMode || !versions.length}
          onChange={(event) => selectPlanningVersion(event.target.value)}>
          {!versions.length && <option value="">尚未创建规划版本</option>}
          {versions.map((version) => <option key={version.id} value={version.id}>{version.id} · {version.name}</option>)}
        </select>}
    </label>
    <span className={`resource-status ${current?.open && current?.published ? "done" : "editing"}`}>{versionStatus(current)}</span>
    {current?.deadline && <small>截止 {new Date(current.deadline).toLocaleString("zh-CN")}</small>}
    <small>{fixed ? "返回“我的 Initiative”切换版本" : "清单、预算、Owner 与草稿按版本独立"}</small>
  </div>;
}
