import { Alert, AlertDescription } from "../../components/ui/alert";
import { Card } from "../../components/ui/card";
import { Checkbox } from "../../components/ui/checkbox";
import { Button } from "../../components/ui/button";
import { Label } from "../../components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "../../components/ui/native-select";
import { useEffect, useState } from "react";
import { useWorkbench } from "../WorkbenchContext.jsx";
import { departmentExpenseLimit } from "../domain/history-permissions";
export { departmentExpenseFields, departmentExpenseLimit } from "../domain/history-permissions";

const resources = ["ICE Rebate", "MRD", "SP&A", "Capex"];
const emptyMapping = {};
const scopedDepartments = ["PCMO", "CRTO", "B2B", "OEM"].flatMap((sector) =>
  ["MKT", "ICE", "CAPEX"].map((department) => `${sector}|${department}`),
);

export function HistoricalResourceSettings({
  mapping = emptyMapping,
  departments = [],
  saveConfig,
  readOnly = false,
}) {
  const context = useWorkbench();
  const [draft, setDraft] = useState(mapping);
  const [busy, setBusy] = useState(false);
  const [departmentError, setDepartmentError] = useState("");
  const names = [
    ...new Set([...Object.keys(draft), ...departments, ...scopedDepartments]),
  ].sort();
  const [selected, setSelected] = useState(
    () => names.find((name) => name.includes("|")) || names[0] || "",
  );
  const selectedDepartment = names.includes(selected)
    ? selected
    : names[0] || "";
  const customDepartment = Object.hasOwn(draft, selectedDepartment);
  useEffect(() => setDraft(mapping), [mapping]);
  const toggle = (setter, name, resource, enabled) =>
    setter((current) => ({
      ...current,
      [name]: enabled
        ? [...(current[name] || []), resource]
        : (current[name] || []).filter((item) => item !== resource),
    }));
  async function saveDepartment() {
    if (readOnly || busy || !selectedDepartment) return;
    setBusy(true);
    setDepartmentError("");
    try {
      const bounded = Object.fromEntries(Object.entries(draft).map(([department, fields]) =>
        [department, fields.filter((field) => departmentExpenseLimit(department).includes(field))]));
      if ((await saveConfig({ departmentResources: bounded })) === false)
        throw new Error("部门默认权限未保存，请重试。");
      context?.notify?.(
        `${selectedDepartment.replace("|", " / ")} 的历史费用默认权限已保存。`,
      );
    } catch (failure) {
      setDepartmentError(failure.message || "部门默认权限保存失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Card className="panel v19-department-permissions gap-0 py-0">
        <div className="panel-header">
          <div>
            <h2>所属部门的历史费用默认权限</h2>
            <p className="v19-permission-description">
              默认显示该部门对应大类，可在此进一步收窄。个人例外请在“用户管理 → 编辑用户 → 历史费用列范围”中配置，不能突破部门范围；缺少有效所属部门时不提供费用明细。
            </p>
          </div>
        </div>
        <div className="v19-department-permission-controls">
          <Label>
            所属部门
            <NativeSelect
              aria-label="历史费用默认权限所属部门"
              value={selectedDepartment}
              disabled={busy}
              onChange={(event) => setSelected(event.target.value)}
            >
              {names.map((name) => (
                <NativeSelectOption key={name} value={name}>
                  {name.replace("|", " / ")}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Label>
          <Label>
            默认策略
            <NativeSelect
              aria-label="部门历史费用默认策略"
              value={customDepartment ? "custom" : "inherit"}
              disabled={busy || readOnly || !selectedDepartment}
              onChange={(event) =>
                setDraft((current) => {
                  const next = { ...current };
                  if (event.target.value === "custom")
                    next[selectedDepartment] = [];
                  else delete next[selectedDepartment];
                  return next;
                })
              }
            >
              <NativeSelectOption value="inherit">
                沿用所属部门对应大类
              </NativeSelectOption>
              <NativeSelectOption value="custom">
                收窄本部门费用列
              </NativeSelectOption>
            </NativeSelect>
          </Label>
          {resources.map((resource) => (
            <Label key={resource} className="v19-permission-check">
              <Checkbox
                aria-label={`${selectedDepartment} 可查看 ${resource}`}
                disabled={busy || readOnly || !customDepartment || !departmentExpenseLimit(selectedDepartment).includes(resource)}
                checked={departmentExpenseLimit(selectedDepartment).includes(resource) && (!customDepartment || (draft[selectedDepartment] || []).includes(resource))}
                onCheckedChange={(checked) =>
                  toggle(
                    setDraft,
                    selectedDepartment,
                    resource,
                    checked === true,
                  )
                }
              />
              {resource}
            </Label>
          ))}
          <Button
            type="button"
            disabled={busy || readOnly || !selectedDepartment}
            onClick={saveDepartment}
          >
            保存部门默认
          </Button>
        </div>
        <p className="small-text">
          历史投资总额、Yield、历史资源占比始终可见。所属部门只关联费用列权限，不改变业务数据范围。SP&A
          为历史合计，暂不拆部门。
        </p>
        {departmentError && (
          <Alert
            variant="destructive"
            role="alert"
            className="v19-permission-error"
          >
            <AlertDescription>{departmentError}</AlertDescription>
          </Alert>
        )}
      </Card>
    </>
  );
}
