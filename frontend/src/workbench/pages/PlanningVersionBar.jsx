import { Label } from "../../components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "../../components/ui/native-select";
import { useWorkbench } from "../WorkbenchContext.jsx";

export function versionStatus(version) {
  if (!version) return "历史工作区";
  if (!version.published) return "未启用";
  if (!version.open) return "已停用";
  return "已启用";
}

export function PlanningVersionBar({ fixed = false, scope = "", children }) {
  const { state, selectPlanningVersion, loading, apiMode } = useWorkbench();
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
      {children && <div className="v19-version-actions">{children}</div>}
    </div>
  );
}
