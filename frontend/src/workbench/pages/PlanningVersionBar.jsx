import { Label } from "../../components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "../../components/ui/native-select";
import { useWorkbench } from "../WorkbenchContext.jsx";

export function versionStatus(version) {
  if (!version) return "历史工作区";
  if (!version.published) return "未发布";
  if (!version.open) return "已关闭提交";
  if (version.deadline && new Date(version.deadline).getTime() <= Date.now())
    return "已截止";
  return "开放提交";
}

export function beijingDeadlineInput(value) {
  if (!value) return "";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 16)
    : "";
}

export function PlanningVersionBar({ fixed = false, scope = "", children }) {
  const { state, identity, selectPlanningVersion, loading, apiMode } = useWorkbench();
  const versions = state.planningVersions || [];
  const current = state.planningVersion;
  return (
    <div className="studio-version-bar">
      <Label>
        版本
        {fixed ? (
          <strong>
            {current ? `${current.id} · ${current.name}` : "当前历史工作区"}
          </strong>
        ) : (
          <NativeSelect
            aria-label="规划版本"
            value={current?.id || ""}
            disabled={loading || !apiMode || !versions.length}
            onChange={(event) => selectPlanningVersion(event.target.value)}
          >
            {!versions.length && (
              <NativeSelectOption value="">尚未创建规划版本</NativeSelectOption>
            )}
            {versions.map((version) => (
              <NativeSelectOption key={version.id} value={version.id}>
                {version.id} · {version.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </Label>
      {fixed && <small>返回我的 Initiative 切换</small>}
      {scope && <span className="v19-version-scope">{scope}</span>}
      {["owner", "lead"].includes(identity?.role) && (
        <span className="v19-version-deadline">
          提交截止时间：{beijingDeadlineInput(current?.deadline)?.replace("T", " ") || "未设置"}（北京时间）
        </span>
      )}
      {children && <div className="v19-version-actions">{children}</div>}
    </div>
  );
}
