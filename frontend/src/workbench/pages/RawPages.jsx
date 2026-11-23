import { assertAuthorizedRead, authorizedReadEpoch, identityScopeKey } from "../identity-scope";
import { currentIdentity } from "../api";
import { wholeMetric, isHistoricalOutput } from "../domain/metric-precision";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { Card } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Label } from "../../components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "../../components/ui/native-select";
import { Input } from "../../components/ui/input";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "../../components/ui/table";
import { Badge } from "../../components/ui/badge";
import { useEffect, useState } from "react";
import { useWorkbench } from "../WorkbenchContext.jsx";
import A from "../domain/explore.js";
import { PageHead } from "./OverviewPages.jsx";
import { validatePortalSession } from "../../portal/session";
import { assertPreviewResponseCurrent, getPreviewEpoch } from "../userPreview";
const fmt = (n) =>
  (Math.abs(n) < 0.05 ? 0 : n).toLocaleString("zh-CN", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
export function RawPage() {
  const { state, identity, data, rawRequest, notify } = useWorkbench();
  const [tab, setTab] = useState(""),
    [search, setSearch] = useState(""),
    [dealerCodeSearch, setDealerCodeSearch] = useState(""),
    [dealerNameSearch, setDealerNameSearch] = useState(""),
    [sectorFilter, setSectorFilter] = useState(""),
    [initiativeSearch, setInitiativeSearch] = useState(""),
    [departmentSearch, setDepartmentSearch] = useState(""),
    [ownerSearch, setOwnerSearch] = useState(""),
    [page, setPage] = useState(1);
  useEffect(() => {
    if (rawRequest) {
      setTab(rawRequest.tab || "");
      const specificTab = ["history", "budgets"].includes(rawRequest.tab);
      setSearch(specificTab ? "" : rawRequest.search || "");
      setDealerCodeSearch(
        rawRequest.tab === "history" ? rawRequest.search || "" : "",
      );
      setDealerNameSearch("");
      setSectorFilter("");
      setInitiativeSearch(
        rawRequest.tab === "budgets" ? rawRequest.search || "" : "",
      );
      setDepartmentSearch("");
      setOwnerSearch("");
      setPage(1);
    }
  }, [rawRequest]);
  const model = A.rawData(state, identity, data, tab || undefined),
    filters =
      model.tab === "history"
        ? {
            dealerCode: dealerCodeSearch,
            dealerName: dealerNameSearch,
            sector: sectorFilter,
          }
        : model.tab === "budgets"
          ? {
              initiative: initiativeSearch,
              department: departmentSearch,
              owner: ownerSearch,
            }
          : search,
    rows = A.filterRows(model, filters),
    pages = Math.max(1, Math.ceil(rows.length / 15)),
    current = Math.min(page, pages);
  const exportCsv = async () => {
    const scopeEpoch = authorizedReadEpoch();
    const previewEpoch = getPreviewEpoch();
    try {
      await validatePortalSession();
      if (identity.apiMode && identityScopeKey(await currentIdentity()) !== identityScopeKey(identity))
        throw Error("授权范围已变化，请重新加载。");
      assertAuthorizedRead(scopeEpoch);
      assertPreviewResponseCurrent(previewEpoch);
      const url = URL.createObjectURL(
        new Blob([A.csv(model, filters)], { type: "text/csv;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `资源规划_${model.tab}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify("已导出当前筛选的数据。");
    } catch {
      if (previewEpoch === getPreviewEpoch())
        notify("导出失败，请重试。", true);
    }
  };
  return (
    <>
      <PageHead
        title="原始数据"
        description="查询与导出当前角色权限内的数据。"
      />
      <Card className="panel raw-panel gap-4 p-4">
        <div className="panel-head">
          <div>
            <h2>{model.title}</h2>
            <p>
              {model.scopeLabel} · {model.basisLabel}
            </p>
          </div>
          <Button variant="outline" type="button" onClick={exportCsv}>
            导出当前筛选 CSV
          </Button>
        </div>
        <div className="toolbar">
          <Tabs value={model.tab} onValueChange={(next) => {
            setTab(next);
            setSearch("");
            setDealerCodeSearch("");
            setDealerNameSearch("");
            setSectorFilter("");
            setInitiativeSearch("");
            setDepartmentSearch("");
            setOwnerSearch("");
            setPage(1);
          }}>
            <TabsList aria-label="原始数据类别" className="flex-wrap h-auto">
              {model.tabs.map((t) => (
                <TabsTrigger
                  value={t.id}
                  key={t.id}
                >
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {model.tab === "history" ? (
            <div className="raw-history-search">
              <Label>
                Sector 业务线
                <NativeSelect
                  value={sectorFilter}
                  onChange={(event) => {
                    setSectorFilter(event.target.value);
                    setPage(1);
                  }}
                >
                  <NativeSelectOption value="">全部业务线</NativeSelectOption>
                  {["PCMO", "CRTO", "B2B", "OEM"].map((sector) => (
                    <NativeSelectOption key={sector} value={sector}>
                      {sector}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Label>
              <Label>
                经销商编码
                <Input
                  type="search"
                  value={dealerCodeSearch}
                  placeholder="模糊搜索经销商编码"
                  onChange={(e) => {
                    setDealerCodeSearch(e.target.value);
                    setPage(1);
                  }}
                />
              </Label>
              <Label>
                经销商名称
                <Input
                  type="search"
                  value={dealerNameSearch}
                  placeholder="模糊搜索经销商名称"
                  onChange={(e) => {
                    setDealerNameSearch(e.target.value);
                    setPage(1);
                  }}
                />
              </Label>
            </div>
          ) : model.tab === "budgets" ? (
            <div className="raw-budget-search">
              <Label>
                Initiative
                <Input
                  type="search"
                  value={initiativeSearch}
                  placeholder="模糊搜索 Initiative"
                  onChange={(e) => {
                    setInitiativeSearch(e.target.value);
                    setPage(1);
                  }}
                />
              </Label>
              <Label>
                部门
                <Input
                  type="search"
                  value={departmentSearch}
                  placeholder="模糊搜索部门"
                  onChange={(e) => {
                    setDepartmentSearch(e.target.value);
                    setPage(1);
                  }}
                />
              </Label>
              <Label>
                Owner
                <Input
                  type="search"
                  value={ownerSearch}
                  placeholder="模糊搜索 Owner"
                  onChange={(e) => {
                    setOwnerSearch(e.target.value);
                    setPage(1);
                  }}
                />
              </Label>
            </div>
          ) : (
            <Label>
              搜索{" "}
              <Input
                type="search"
                value={search}
                placeholder="搜索当前权限内的数据"
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </Label>
          )}
        </div>
        <div className="table-scroll">
          <Table key={model.tab} pageIndex={current - 1} pageSize={15} onSort={() => setPage(1)} containerClassName="overflow-visible">
            <TableHeader>
              <TableRow>
                {model.columns.map((c) => (
                  <TableHead key={c.key}>{c.label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, n) => (
                <TableRow key={`${model.tab}-${current}-${n}`}>
                  {model.columns.map((c) => (
                    <TableCell key={c.key} sortValue={r[c.key]}>
                      {typeof r[c.key] === "number"
                        ? c.key === "yield"
                          ? r[c.key].toFixed(1)
                          : isHistoricalOutput(c.key) ? wholeMetric(r[c.key]) : fmt(r[c.key])
                        : r[c.key]}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              {!rows.length && (
                <TableRow>
                  <TableCell colSpan={model.columns.length}>
                    暂无匹配数据
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <div className="toolbar raw-pagination">
          <span>
            共 {rows.length} 行 · 第 {current} / {pages} 页
          </span>
          <Button
            variant="outline"
            type="button"

            disabled={current === 1}
            onClick={() => setPage(current - 1)}
          >
            上一页
          </Button>
          <Button
            variant="outline"
            type="button"

            disabled={current === pages}
            onClick={() => setPage(current + 1)}
          >
            下一页
          </Button>
        </div>
        <div className="raw-notes">
          {model.notes.map((n) => (
            <p key={n} className="muted">
              {n}
            </p>
          ))}
        </div>
      </Card>
    </>
  );
}
export function TrackingPage() {
  const { identity, navigate } = useWorkbench();
  const home =
    identity.role === "owner"
      ? "home"
      : identity.role === "lead"
        ? "department"
        : identity.role === "admin"
          ? "admin"
          : "management";
  return (
    <>
      <PageHead
        title="执行追踪"
        description="后续规划 · 一期聚焦年度资源分配与持续更新。"
      />
      <Card className="panel gap-0 py-0">
        <div className="empty" style={{ padding: "65px 24px" }}>
          <Badge variant="secondary" className="badge blue">
            功能预留
          </Badge>
          <h2 style={{ margin: "15px 0 8px" }}>2027 执行 Tracking 尚未定义</h2>
          <p>
            未来可基于年度资源方案继续跟踪。指标、数据来源和业务流程需另行确认，当前不展示虚构的实际支出、利用率或季度分析。
          </p>
          <Button
            variant="outline"
            type="button"
            onClick={() => navigate(home)}
          >
            返回当前工作区
          </Button>
        </div>
      </Card>
    </>
  );
}
export function AboutPage() {
  const { data } = useWorkbench();
  const definitions = [
    ["数据来源", data.metadata.sourceFile],
    ["2027 计划", "75 项 Initiative / 600 条分配 / 总预算 6,402,000"],
    ["金额单位", "源文件未标注；原值保留，不默认解释为元、千元或万元。"],
    ["经销商", "展示历史参考数据提供的经销商编码及名称；缺失名称不补造。"],
    ["2024 / 2025", "全年历史 Vol 与 C3；2025 资源按四类明细重新核对加总。"],
    ["2026", "1—8 月累计为演示假设；不直接计算全年同比、不年化。"],
    [
      "Yield",
      "2025 C3（美元）÷ 历史投资（美元），历史投资已按配置汇率统一为美元，仅作表现参考，不转换为百分比或回报倍数。所有角色均可只读查看本权限范围内的 Yield；资源明细仍按部门隔离。",
    ],
    [
      "历史去重",
      "经销商历史仅保存一份，不复制到多个 Initiative / Sector 后加总。",
    ],
    ["未提供的数据", "2027 预计 Vol / C3、实际执行支出均保持未提供。"],
  ];
  return (
    <>
      <PageHead
        title="数据口径与演示说明"
        description="区分源数据、演示配置和后续待接入能力。"
      />
      <div className="columns">
        <div className="main-column">
          <Card className="panel gap-0 py-0">
            <div className="panel-header">
              <h2>源数据与计算口径</h2>
            </div>
            <div className="panel-body">
              <dl className="definition-grid">
                {definitions.map(([name, value]) => (
                  <Definition key={name} name={name} value={value} />
                ))}
              </dl>
            </div>
          </Card>
          <Card className="panel gap-0 py-0">
            <div className="panel-header">
              <h2>一期目标架构</h2>
              <Badge variant="secondary" className="badge">
                未接通
              </Badge>
            </div>
            <div className="panel-body">
              <div className="flow-diagram">
                <span>工作台前端</span>
                <b>→</b>
                <span>应用后端</span>
                <b>→</b>
                <span>PostgreSQL</span>
              </div>
              <p className="small-text muted">
                历史与经销商主数据由数据团队刷新到 PostgreSQL；应用后端按授权范围读取数据，
                保存规划版本、预算分配及提交记录。
              </p>
            </div>
          </Card>
        </div>
        <aside className="aside-stack">
          <Card className="panel gap-0 py-0">
            <div className="panel-header">
              <h2>演示能力边界</h2>
            </div>
            <div className="panel-body">
              {[
                [
                  "本地可交互",
                  "拆分、Excel 往返、反复同步与最新版本汇总。",
                ],
                [
                  "模拟配置",
                  "MKT / ICE / CAPEX，Owner 编号、意见与批次发布。",
                ],
                [
                  "未连接服务",
                  "SSO、PG、真实后端鉴权与多人协作。",
                ],
              ].map(([name, value]) => (
                <div className="list-item" key={name}>
                  <b>{name}</b>
                  <p className="small-text muted">{value}</p>
                </div>
              ))}
            </div>
          </Card>
          <Card className="panel gap-0 py-0">
            <div className="panel-header">
              <h2>快速演示顺序</h2>
            </div>
            <div className="panel-body">
              <ol className="small-text muted">
                <li>Marketer 配置本人 Initiative</li>
                <li>添加其他预算安排并配平</li>
                <li>查看本人汇总与历史指标</li>
                <li>同步最新分配</li>
                <li>管理层筛选、排序查看最新版本</li>
                <li>Marketer 再次调整并同步，最新更新时间随之刷新</li>
              </ol>
            </div>
          </Card>
        </aside>
      </div>
    </>
  );
}
function Definition({ name, value }) {
  return (
    <>
      <dt>{name}</dt>
      <dd>{value}</dd>
    </>
  );
}
