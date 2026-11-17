import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useWorkbench } from "../WorkbenchContext.jsx";
import {
  VALID_LEGEND_COLOR,
  resolveResourceColor,
  resolveDepartmentColor,
} from "../LegendColors";
import "./admin-legend-colors.css";

export function legendColorPayload(draft) {
  const result = { ...(draft.initiatives ? { initiatives: draft.initiatives } : {}), resources: {}, departments: {} };
  for (const group of ["resources", "departments"]) {
    for (const [key, value] of Object.entries(draft[group] || {})) {
      const color = String(value).trim();
      if (!color) continue;
      if (!VALID_LEGEND_COLOR.test(color))
        throw new Error("颜色须为 # 加六位十六进制，例如 #003C88。");
      result[group][key] = color.toUpperCase();
    }
  }
  return result;
}

export function AdminLegendColors() {
  const { state, view, saveConfig, previewMode, identity } = useWorkbench();
  const saved = JSON.stringify(state.legendColors || {});
  const [draft, setDraft] = useState(() => JSON.parse(saved));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setDraft(JSON.parse(saved));
    setError("");
  }, [saved, identity?.email]);
  const items = view?.initiatives || state.initiatives || [];
  const resources = [
    ...new Set([
      "ICE Rebate",
      "MRD",
      "SP&A",
      "Capex",
      ...items
        .map((item) =>
          item.resourceType === "CAPEX"
            ? "Capex"
            : item.resourceType === "BTL"
              ? "SP&A"
              : item.resourceType,
        )
        .filter(Boolean),
    ]),
  ];
  const departments = [
    ...new Set([
      "MKT",
      "ICE",
      "CAPEX",
      ...items.map((item) => item.department?.toUpperCase()).filter(Boolean),
    ]),
  ];
  const groups = [
    {
      key: "resources",
      label: "资源大类",
      rows: resources.map((key) => ({
        key,
        label: key,
        color: resolveResourceColor(key),
      })),
    },
    {
      key: "departments",
      label: "部门",
      rows: departments.map((key) => ({
        key,
        label: key,
        color: resolveDepartmentColor(key),
      })),
    },
  ];
  const change = (group, key, color) => {
    setError("");
    setDraft((old) => ({ ...old, [group]: { ...old[group], [key]: color } }));
  };
  const disabled = busy || previewMode;
  const dirty =
    JSON.stringify(legendColorPayloadSafe(draft)) !==
    JSON.stringify(legendColorPayloadSafe(JSON.parse(saved)));
  return (
    <Card className="panel studio-admin-panel legend-color-settings">
      <div className="panel-header">
        <div>
          <h2>颜色图例</h2>
          <p>
            设置资源大类和部门的标签与图表颜色；清空颜色恢复默认。Initiative 使用默认颜色。
          </p>
        </div>
      </div>
      <Tabs defaultValue="resources">
        <TabsList aria-label="颜色图例类别">
          {groups.map((group) => (
            <TabsTrigger key={group.key} value={group.key}>
              {group.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {groups.map((group) => (
          <TabsContent key={group.key} value={group.key}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{group.label}</TableHead>
                  <TableHead>图例颜色</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.rows.map((row) => {
                  const value = draft[group.key]?.[row.key] || "";
                  const valid =
                    !value.trim() || VALID_LEGEND_COLOR.test(value.trim());
                  const color =
                    valid && value.trim() ? value.trim() : row.color;
                  return (
                    <TableRow key={row.key}>
                      <TableCell sortValue={row.label}>
                        <strong>{row.label}</strong>
                        {row.detail && <small>{row.detail}</small>}
                      </TableCell>
                      <TableCell>
                        <div className="legend-color-inputs">
                          <Input
                            type="color"
                            aria-label={`${row.label}颜色选择`}
                            value={color}
                            disabled={disabled}
                            onChange={(event) =>
                              change(group.key, row.key, event.target.value)
                            }
                          />
                          <Input
                            aria-label={`${row.label}颜色代码`}
                            value={value}
                            placeholder={`默认 ${row.color}`}
                            maxLength={7}
                            aria-invalid={!valid}
                            disabled={disabled}
                            onChange={(event) =>
                              change(group.key, row.key, event.target.value)
                            }
                          />
                          <span
                            className="legend-color-preview"
                            style={{
                              borderColor: color,
                              background: `color-mix(in srgb, ${color} 15%, white)`,
                            }}
                          >
                            {row.label}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={disabled || !value}
                          onClick={() => change(group.key, row.key, "")}
                        >
                          恢复默认
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TabsContent>
        ))}
      </Tabs>
      {error && (
        <p role="alert" className="legend-color-error">
          {error}
        </p>
      )}
      <div className="actions studio-admin-save">
        <Button
          disabled={disabled || !dirty}
          onClick={async () => {
            let colors;
            try {
              colors = legendColorPayload(draft);
            } catch (failure) {
              setError(failure.message);
              return;
            }
            setBusy(true);
            setError("");
            try {
              if (!(await saveConfig({ legendColors: colors })))
                setError("颜色未保存，请查看提示并重试；当前编辑仍保留。");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "保存中…" : "保存颜色图例"}
        </Button>
      </div>
    </Card>
  );
}
function legendColorPayloadSafe(value) {
  try {
    return legendColorPayload(value);
  } catch {
    return value;
  }
}
