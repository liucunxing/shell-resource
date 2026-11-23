import { AdminLegendColors } from "./AdminLegendColors";
import { DepartmentLabel, useLegendColors } from "../LegendColors";
import { Card } from "../../components/ui/card";
import { wholeMetric } from "../domain/metric-precision";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "../../components/ui/table";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Label } from "../../components/ui/label";
import { useState } from "react";
import { useWorkbench } from "../WorkbenchContext.jsx";
import { configuredYtdLabel } from "../domain/dealer-history";

export function StudioConfiguration({ thresholds = false }) {
  const { state, view, data, saveConfig, previewMode } = useWorkbench();
  const [reasons, setReasons] = useState(() =>
    structuredClone(state.budgetReasons || []),
  );
  const [values, setValues] = useState(
    state.healthThresholds || {
      concentrationYellow: 5,
      concentrationRed: 10,
      dealerYellow: 3,
      dealerRed: 6,
    },
  );
  const [busy, setBusy] = useState(false),
    [label, setLabel] = useState("");
  const [ytdMonth, setYtdMonth] = useState(
    state.configuredYtdCutoffMonth ?? state.ytdCutoffMonth ?? 10,
  );
  const [exchangeRate, setExchangeRate] = useState(state.historyInvestmentExchangeRate ?? 1);
  const validRate = typeof exchangeRate === "number" && Number.isFinite(exchangeRate) && exchangeRate > 0;
  const validMonth =
    Number.isInteger(ytdMonth) && ytdMonth >= 1 && ytdMonth <= 12;
  const save = async () => {
    setBusy(true);
    try {
      await saveConfig(
        thresholds ? { healthThresholds: values } : { budgetReasons: reasons },
      );
    } finally {
      setBusy(false);
    }
  };
  if (thresholds)
    return (
      <Card className="panel studio-admin-panel gap-4 p-4">
        <div className="panel-header">
          <div>
            <h2>健康检查阈值</h2>
            <p>差值仅提示复核，不替代业务判断。单位为百分点（pp）。</p>
          </div>
        </div>
        <Table containerClassName="overflow-visible">
          <TableHeader>
            <TableRow>
              <TableHead>指标</TableHead>
              <TableHead>黄色阈值</TableHead>
              <TableHead>红色阈值</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[
              ["concentration", "集中度偏离"],
              ["dealer", "经销商超配 / 低配"],
            ].map(([key, title]) => (
              <TableRow key={key}>
                <TableHead>{title}</TableHead>
                {["Yellow", "Red"].map((severity) => (
                  <TableCell key={severity}>
                    <Input
                      aria-label={`${title}${severity === "Yellow" ? "黄色" : "红色"}阈值`}
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={values[key + severity]}
                      onChange={(event) =>
                        setValues({
                          ...values,
                          [key + severity]: Number(event.target.value),
                        })
                      }
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="actions studio-admin-save">
          <Button
            variant="default"
            type="button"
            disabled={busy || previewMode}
            onClick={save}
          >
            {busy ? "保存中…" : "保存阈值"}
          </Button>
        </div>
      </Card>
    );
  const metadata = state.reference || {};
  return (
    <>
      <AdminLegendColors />
      <OrganizationReferencePanels
        metadata={metadata}
        items={view?.initiatives || []}
        dealers={data?.dealers || []}
      />
      <Card className="panel studio-admin-panel gap-4 p-4">
        <h2>历史投资汇率</h2>
        <Label htmlFor="history-investment-rate">每 1 美元对应的历史投资原始金额</Label>
        <Input
          id="history-investment-rate"
          type="number"
          min="0"
          step="any"
          value={exchangeRate}
          disabled={busy || previewMode}
          aria-invalid={!validRate}
          onChange={(event) => setExchangeRate(event.target.value === "" ? "" : Number(event.target.value))}
        />
        <p>历史投资原始金额 ÷ 汇率 = 美元金额。当前源数据已是美元，默认填 1；未来若源数据改为人民币，可填对应的人民币兑美元汇率，例如 7.2。</p>
        <p className="small-text muted">此配置统一应用于各年历史费用及 Yield。C3 已是美元，不重复换算；规划预算和分配仍按人民币保存和显示。负费用按原正负号参与净额计算。</p>
        {!validRate && <p role="alert">请输入大于 0 的有效汇率。</p>}
        <Button disabled={busy || previewMode || !validRate} onClick={async () => {
          setBusy(true);
          try { await saveConfig({ historyInvestmentExchangeRate: exchangeRate }); }
          finally { setBusy(false); }
        }}>保存历史投资汇率</Button>
      </Card>
      <Card className="panel studio-admin-panel gap-4 p-4">
        <h2>YTD 截止月份配置</h2>
        <Label htmlFor="ytd-cutoff-month">2026 YTD 截止月份</Label>
        <Input
          id="ytd-cutoff-month"
          type="number"
          min="1"
          max="12"
          step="1"
          value={ytdMonth}
          disabled={busy || previewMode}
          onChange={(event) =>
            setYtdMonth(
              event.target.value === "" ? "" : Number(event.target.value),
            )
          }
        />
        <p>
          {validMonth ? configuredYtdLabel(ytdMonth) : "请输入 1–12 的整数月份"}
        </p>
        <p className="small-text muted">
          默认 10 月。已有当前批次的期间确认时，页面使用已确认月份；数据换批后须重新核对。
          这里保存的月份不会补齐源数据，也不会单独解除 YTD Yield 的期间校验。
        </p>
        <Button
          disabled={busy || previewMode || !validMonth}
          onClick={async () => {
            setBusy(true);
            try {
              await saveConfig({ ytdCutoffMonth: ytdMonth });
            } finally {
              setBusy(false);
            }
          }}
        >
          保存截止月份
        </Button>
      </Card>
      <Card className="panel studio-admin-panel gap-4 p-4">
        <div className="panel-header">
          <div>
            <h2>预留原因</h2>
            <p>
              Owner
              从启用原因中选择。已使用原因不能改名或删除，可以停用；历史记录保留。
            </p>
          </div>
        </div>
        <Table containerClassName="overflow-visible">
          <TableHeader>
            <TableRow>
              <TableHead>编码</TableHead>
              <TableHead>原因名称</TableHead>
              <TableHead>启用</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reasons.map((reason, index) => (
              <TableRow key={reason.id}>
                <TableCell>{reason.id}</TableCell>
                <TableCell>
                  <Input
                    aria-label={`预留原因 ${index + 1}`}
                    value={reason.label}
                    onChange={(event) =>
                      setReasons(
                        reasons.map((item) =>
                          item.id === reason.id
                            ? { ...item, label: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </TableCell>
                <TableCell>
                  <Checkbox
                    aria-label={`启用 ${reason.label}`}
                    checked={reason.enabled}
                    onCheckedChange={(checked) =>
                      setReasons(
                        reasons.map((item) =>
                          item.id === reason.id
                            ? { ...item, enabled: checked === true }
                            : item,
                        ),
                      )
                    }
                  />
                </TableCell>
                <TableCell>
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    disabled={busy || previewMode}
                    onClick={() =>
                      setReasons(
                        reasons.filter((item) => item.id !== reason.id),
                      )
                    }
                  >
                    删除未使用原因
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="studio-inline-controls">
          <Label>
            新增原因
            <Input
              value={label}
              maxLength="120"
              onChange={(event) => setLabel(event.target.value)}
            />
          </Label>
          <Button
            variant="outline"
            type="button"
            disabled={!label.trim() || previewMode}
            onClick={() => {
              setReasons([
                ...reasons,
                {
                  id: `reason-${crypto.randomUUID()}`,
                  label: label.trim(),
                  enabled: true,
                },
              ]);
              setLabel("");
            }}
          >
            添加原因
          </Button>
          <Button
            variant="default"
            type="button"
            disabled={busy || previewMode}
            onClick={save}
          >
            {busy ? "保存中…" : "保存原因配置"}
          </Button>
        </div>
      </Card>
    </>
  );
}

function OrganizationReferencePanels({ metadata, items, dealers }) {
  const { resourceColor } = useLegendColors();
  const groups = [
    ["Sector", "sector", ["PCMO", "B2B", "CRTO", "OEM"]],
    ["Department", "department", ["MKT", "ICE", "CAPEX"]],
    ["资源大类", "resourceType", ["ICE Rebate", "MRD", "SP&A", "Capex"]],
  ];
  const sdCounts = new Map();
  const dealerKeys = new Set();
  for (const dealer of dealers) {
    const key = `${dealer.sector}:${dealer.id}`;
    if (dealerKeys.has(key)) continue;
    dealerKeys.add(key);
    const sd = dealer.sd || "未提供 SD";
    sdCounts.set(sd, (sdCounts.get(sd) || 0) + 1);
  }
  return (
    <>
      <div className="v19-org-grid">
        {groups.map(([title, key, defaults]) => (
          <Card className="panel studio-admin-panel" key={key}>
            <div className="panel-header">
              <h2>{title}</h2>
            </div>
            <div className="v19-org-values">
              {[
                ...new Set([
                  ...defaults,
                  ...items.map((item) => item[key]).filter(Boolean),
                ]),
              ].map((value) => (
                <div key={value}>
                  <span>{key === "department" ? <DepartmentLabel name={value} /> : key === "resourceType" ? <span className="legend-department-label"><i aria-hidden="true" style={{ background: resourceColor(value) }} />{value}</span> : value}</span>
                  <small>
                    {wholeMetric(items.filter((item) => item[key] === value).length)} 个项目
                  </small>
                </div>
              ))}
            </div>
            <p className="small-text muted">当前业务字典 · 只读</p>
          </Card>
        ))}
      </div>
      <Card className="panel studio-admin-panel">
        <div className="panel-header">
          <h2>历史数据源覆盖</h2>
        </div>
        <p>历史数据覆盖情况</p>
        <Table containerClassName="overflow-visible">
          <TableHeader>
            <TableRow>
              <TableHead>数据集</TableHead>
              <TableHead>最新数据月份</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[
              ["Actual Vol / C3", metadata.actual?.latestMonth],
              ["历史投资 / 费用明细", metadata.investment?.latestMonth],
              ["合同量", metadata.contract?.latestMonth],
            ].map(([label, month]) => (
              <TableRow key={label}>
                <TableCell>{label}</TableCell>
                <TableCell>{month || "来源未提供"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="small-text muted">
          真实覆盖月份由数据源元数据提供，与管理端期间配置分别保存。月份不齐或无法核对时，不计算跨月
          Yield。
        </p>
      </Card>
      <Card className="panel studio-admin-panel">
        <div className="panel-header">
          <h2>经销商主数据（只读）</h2>
        </div>
        <div className="v19-org-values">
          {[...sdCounts].map(([sd, count]) => (
            <div key={sd}>
              <span>{sd}</span>
              <small>{wholeMetric(count)} 家</small>
            </div>
          ))}
        </div>
        <p className="small-text muted">
          当前已加载数据范围，共 {wholeMetric(dealerKeys.size)} 家；不代表完整主数据覆盖。
        </p>
      </Card>
    </>
  );
}
