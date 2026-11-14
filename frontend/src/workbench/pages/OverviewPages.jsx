import { useMemo, useState } from "react";
import { useWorkbench } from "../WorkbenchContext.jsx";
import E from "../domain/engine.js";
import { PlanningVersionBar as VersionBar } from "./PlanningVersionBar.jsx";
import { VersionComparison } from "./VersionComparison.jsx";
import { SdAnalysis } from "./SdAnalysis.jsx";
import { WorkflowDialog } from "./WorkflowDialog.jsx";
import {
  historyDisplayValue,
  historyInvestment,
  historyYield,
} from "../domain/dealer-history";
import {
  concentration,
  dealerDeviations,
  portfolioRows,
} from "../domain/portfolio-analytics.js";

const num = (value, digits = 0) =>
  Number(value || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
const wan = (value) => `${num(Number(value || 0) / 10000, 1)} 万`;
const pct = (value, digits = 1) =>
  value == null ? "—" : `${num(value, digits)}%`;
const pp = (value) =>
  value == null ? "—" : `${value >= 0 ? "+" : ""}${num(value, 1)}pp`;
const metricLabel = (basis) => (basis === "vol" ? "Delivery Vol" : "C3");
export function PageHead({ eyebrow, title, description, children }) {
  return (
    <header className="studio-page-head">
      <div>
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children && <div className="actions">{children}</div>}
    </header>
  );
}

function Metrics({ entries }) {
  return (
    <div className="studio-metrics">
      {entries.map(([label, value, note, tone = ""]) => (
        <article className={tone} key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
          <small>{note}</small>
        </article>
      ))}
    </div>
  );
}

function Status({ status }) {
  const submitted = status === "completed";
  return (
    <span className={`resource-status ${submitted ? "done" : "editing"}`}>
      {submitted ? "已提交" : "草稿"}
    </span>
  );
}

export function HomePage() {
  const { view, navigate } = useWorkbench();
  const items = view.initiatives || [];
  const filtered = items;
  const total = E.totals(filtered);
  return (
    <>
      <PageHead
        eyebrow="OWNER / MY INITIATIVES"
        title="预算分到哪里，还有多少没分？"
        description="选择 Initiative 进入三步拆分：预算与预留、经销商范围、试算微调与提交。"
      />
      <VersionBar />
      <Metrics
        entries={[
          [
            "本版预算",
            wan(total.budget),
            `${filtered.length} 个 Initiative`,
            "accent",
          ],
          [
            "已分配到经销商",
            wan(total.allocated),
            `占预算 ${pct(total.budget ? (total.allocated / total.budget) * 100 : 0)}`,
          ],
          ["预留", wan(total.otherBudget), "有原因、暂不分配"],
          [
            "待分配",
            wan(Math.max(0, total.gap)),
            total.gap ? "完成配平后可提交" : "当前范围已配平",
            total.gap ? "warn" : "success",
          ],
        ]}
      />
      <section className="studio-card-heading">
        <div>
          <h2>我的 Initiative</h2>
          <p>{filtered.length} 项 · 按当前版本独立维护</p>
        </div>
      </section>
      <div className="studio-initiative-grid">
        {filtered.map((item) => {
          const totals = E.totals([item]);
          const pending = Math.max(0, totals.gap);
          return (
            <article key={item.id} className="studio-initiative-card">
              <div className="studio-card-meta">
                <Status status={item.status} />
                <span>r{item.revision || 1}</span>
              </div>
              <small>{item.id}</small>
              <h2>{item.name}</h2>
              <p>
                {item.sector} · {item.department} · {item.resourceType}
              </p>
              <strong>{wan(item.budget)}</strong>
              <span className="studio-progress">
                <i
                  style={{
                    width: `${Math.min(100, item.budget ? ((totals.allocated + totals.otherBudget) / item.budget) * 100 : 0)}%`,
                  }}
                />
              </span>
              <dl>
                <div>
                  <dt>已分配</dt>
                  <dd>{wan(totals.allocated)}</dd>
                </div>
                <div>
                  <dt>预留</dt>
                  <dd>{wan(totals.otherBudget)}</dd>
                </div>
                <div>
                  <dt>待分配</dt>
                  <dd className={pending ? "negative" : "positive"}>
                    {wan(pending)}
                  </dd>
                </div>
              </dl>
              <button
                className="button primary"
                onClick={() => navigate("editor", item.id)}
              >
                进入拆分
              </button>
            </article>
          );
        })}
        {!filtered.length && (
          <div className="empty">当前筛选范围没有 Initiative。</div>
        )}
      </div>
    </>
  );
}

export function SubmissionPage() {
  const { view, state, navigate, publish, savedForSyncIds, editorOperations } =
    useWorkbench();
  const items = view.initiatives || [];
  const ready = items.filter((item) => savedForSyncIds.has(item.id) && item.workflow?.editable !== false && (!state.planningVersion?.sourceVersionId || item.changeReason?.trim()));
  return (
    <>
      <PageHead
        eyebrow="OWNER / DRAFT & SUBMISSION"
        title="当前版本的草稿与提交"
        description="先选版本再拆分，不把同一份草稿任意提交到不同预算版本。"
      />
      <VersionBar />
      <section className="panel studio-submission-panel">
        <div className="panel-header">
          <div>
            <h2>{state.planningVersion?.name || "当前工作区"} · 当前 Owner</h2>
            <p className="muted">
              提交覆盖仅限当前版本选中的项目，保留修订审计。
            </p>
          </div>
          <button
            className="button primary"
            disabled={!ready.length}
            onClick={async () => {
              for (const item of ready) await publish(item.id, item.changeReason || "");
            }}
          >
            提交本版所有已配平项目
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Initiative</th>
                <th className="num">本版预算（万）</th>
                <th className="num">已分配</th>
                <th className="num">预留</th>
                <th className="num">待分配</th>
                <th>提交状态</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const totals = E.totals([item]);
                return (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.name}</strong>
                      <small>{item.id}</small>
                    </td>
                    <td className="num">{num(item.budget / 10000, 1)}</td>
                    <td className="num">{num(totals.allocated / 10000, 1)}</td>
                    <td className="num">{num(totals.otherBudget / 10000, 1)}</td>
                    <td className="num">
                      {num(Math.max(0, totals.gap) / 10000, 1)}
                    </td>
                    <td>
                      <Status status={item.status} />{" "}
                      {item.publishedRevision
                        ? `r${item.publishedRevision}`
                        : ""}
                    </td>
                    <td>
                      <button
                        className="button small"
                        disabled={Boolean(editorOperations[item.id])}
                        onClick={() => navigate("editor", item.id)}
                      >
                        编辑
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function latestPublished(state) {
  return Object.values(state.publications || {})
    .map((rows) => rows.at(-1)?.initiative)
    .filter(Boolean);
}
function BoardFilters({ items, filters, setFilters, executive }) {
  const options = (key) =>
    [...new Set(items.map((item) => item[key]).filter(Boolean))].sort();
  const keys = executive
    ? [
        ["sector", "Sector"],
        ["department", "Department"],
        ["resourceType", "资源大类"],
      ]
    : [["name", "Initiative"]];
  return (
    <section className="studio-filter-row panel">
      {keys.map(([key, label]) => (
        <label key={key}>
          {label}
          <select
            value={filters[key]}
            onChange={(event) =>
              setFilters({ ...filters, [key]: event.target.value })
            }
          >
            <option value="all">全部</option>
            {options(key).map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      ))}
    </section>
  );
}

function TotalSection({ items, rows, total, mode }) {
  const unsubmitted = Math.max(
    0,
    total.budget - total.allocated - total.otherBudget,
  );
  const pendingLabel = mode === "owner" ? "待分配" : mode === "exec" ? "待确认预算" : "未提交";
  return (
    <section id="studio-total" className="panel studio-section">
      <header>
        <span>①</span>
        <div>
          <h2>总盘 · 预算有多少，分下去多少</h2>
          <p>{mode === "exec" ? "预算包含本版配置项目；分配与预留仅汇总部门已确认快照。" : "预算 = 已分配到经销商 + 预留 + 未提交"}</p>
        </div>
      </header>
      <Metrics
        entries={[
          [
            "预算",
            wan(total.budget),
            `${items.length} 个 Initiative`,
            "accent",
          ],
          ["已分配到经销商", wan(total.allocated), `${rows.length} 家经销商`],
          ["预留", wan(total.otherBudget), "有原因、暂不分配"],
          [
            pendingLabel,
            wan(unsubmitted),
            unsubmitted ? "仍需处理" : "当前范围已完成",
            unsubmitted ? "warn" : "success",
          ],
        ]}
      />
      <div className="studio-budget-flow">
        {[
          ["已分配到经销商", total.allocated],
          ["预留", total.otherBudget],
          [pendingLabel, unsubmitted],
        ].map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <i>
              <b
                style={{
                  width: `${total.budget ? (value / total.budget) * 100 : 0}%`,
                }}
              />
            </i>
            <strong>{wan(value)}</strong>
            <small>
              {pct(total.budget ? (value / total.budget) * 100 : 0)}
            </small>
          </div>
        ))}
      </div>
    </section>
  );
}

function HealthSection({
  rows,
  basis,
  setBasis,
  period,
  setPeriod,
  executive,
}) {
  const { state } = useWorkbench();
  const thresholds = state.healthThresholds || { concentrationYellow: 5, concentrationRed: 10, dealerYellow: 3, dealerRed: 6 };
  const label = metricLabel(basis),
    summaries = [20, 50, 80].map((top) => [top, concentration(rows, top)]),
    deviations = dealerDeviations(rows),
    over = deviations.filter((row) => row.gap > thresholds.dealerYellow).length;
  return (
    <section id="studio-health" className="panel studio-section">
      <header>
        <span>②</span>
        <div>
          <h2>
            {executive
              ? "集中度 · 各资源大类的投资是否集中在少数经销商"
              : "健康检查 · 投资分布与产出是否匹配"}
          </h2>
          <p>经销商按投入从高到低排序；差值为投资金额占比减产出占比。</p>
        </div>
      </header>
      <div className="studio-inline-controls">
        <label>
          产出口径
          <select
            value={basis}
            onChange={(event) => setBasis(event.target.value)}
          >
            <option value="c3">C3</option>
            <option value="vol">Delivery Vol</option>
          </select>
        </label>
        <label>
          历史数据期间
          <select
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
          >
            <option value="2025">2025 全年</option>
            <option value="2026Ytd">2026 YTD（月份由数据源提供）</option>
          </select>
        </label>
        <small>只改变参考数据，不重算已分配金额</small>
      </div>
      <div className="studio-health-grid">
        <div>
          <h3>累计集中度</h3>
          <table>
            <thead>
              <tr>
                <th>投资金额最多的</th>
                <th className="num">家数</th>
                <th className="num">获得投资</th>
                <th className="num">贡献 {label}</th>
                <th className="num">差值</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map(([top, result]) => (
                <tr key={top}>
                  <td>Top {top}%</td>
                  <td className="num">{result?.n ?? "—"}</td>
                  <td className="num">
                    {result ? pct(result.amountShare) : "—"}
                  </td>
                  <td className="num">
                    {result ? pct(result.metricShare) : "—"}
                  </td>
                  <td className="num">
                    <b className={result?.gap > thresholds.concentrationRed ? "negative" : ""}>
                      {result ? pp(result.gap) : "—"}
                    </b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <aside>
          <span>结论</span>
          <strong>{over} 家经销商超配 &gt;{thresholds.dealerYellow}pp</strong>
          <p>
            差值 &gt;{thresholds.dealerYellow}pp 提示复核，&gt;{thresholds.dealerRed}pp
            优先关注；无历史的新经销商不参与比较。
          </p>
        </aside>
      </div>
    </section>
  );
}

function DestinationSection({ items, executive }) {
  const keys = executive
    ? [...new Set(items.map((item) => item.resourceType))]
    : items.map((item) => item.id);
  const groups = keys
    .map((key) => {
      const scoped = executive
        ? items.filter((item) => item.resourceType === key)
        : items.filter((item) => item.id === key);
      return {
        key,
        label: executive ? key : scoped[0]?.name,
        total: E.totals(scoped),
        owner: scoped[0]?.ownerLabel || scoped[0]?.ownerId,
      };
    })
    .sort((a, b) => b.total.budget - a.total.budget);
  return (
    <section id="studio-destination" className="panel studio-section">
      <header>
        <span>③</span>
        <div>
          <h2>
            投资分配去向 · 按 {executive ? "资源大类" : "Initiative"} 概览
          </h2>
          <p>查看预算、已分配、预留和未提交的去向。</p>
        </div>
      </header>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{executive ? "资源大类" : "Initiative"}</th>{!executive && <th>Owner</th>}
              <th className="num">预算（万）</th>
              <th className="num">已分配（万）</th>
              <th className="num">预留（万）</th>
              <th className="num">未提交（万）</th>
              <th className="num">已分配率</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr key={group.key}>
                <td>
                  <strong>{group.label}</strong>
                  {!executive && <small>{group.key}</small>}
                </td>
                {!executive && <td>{group.owner}</td>}
                <td className="num">{num(group.total.budget / 10000, 1)}</td>
                <td className="num">{num(group.total.allocated / 10000, 1)}</td>
                <td className="num">{num(group.total.otherBudget / 10000, 1)}</td>
                <td className="num">
                  {num(Math.max(0, group.total.gap) / 10000, 1)}
                </td>
                <td className="num">
                  {pct(
                    group.total.budget
                      ? (group.total.allocated / group.total.budget) * 100
                      : 0,
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DealerSection({ items, dealers, executive }) {
  const [basis, setBasis] = useState("c3"), [period, setPeriod] = useState("2025");
  const rows = portfolioRows(items, dealers, basis, period);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState(null), [sort, setSort] = useState({ key: "amount", direction: -1 });
  const header = (key, label) => <th className={!["name", "sd", "rsm"].includes(key) ? "num" : ""} aria-sort={sort.key === key ? sort.direction === 1 ? "ascending" : "descending" : "none"}><button className="v19-sort" onClick={() => { setSort({ key, direction: sort.key === key ? -sort.direction : 1 }); setPage(1); }}>{label}{sort.key === key ? sort.direction === 1 ? " ↑" : " ↓" : " ↕"}</button></th>;
  const shares = (field) =>
    new Map(
      dealerDeviations(
        rows.map((row) => ({ ...row, metric: row.history?.[field] ?? null })),
      ).map((row) => [row.key, row.metricShare]),
    );
  const volShares = shares(period === "2025" ? "vol2025" : "vol2026Ytd");
  const c3Shares = shares(period === "2025" ? "c32025" : "c32026Ytd");
  const byKey = new Map(dealerDeviations(rows).map((row) => [row.key, row]));
  const deviations = rows
    .map(
      (row) => byKey.get(row.key) || { ...row, amountShare: null, gap: null },
    )
    .filter((row) =>
      `${row.id} ${row.name}`.toLowerCase().includes(search.toLowerCase()),
    ).sort((a, b) => {
      const value = (row) => ({ volShare: volShares.get(row.key), c3Share: c3Shares.get(row.key), vol: row.history?.[period === "2025" ? "vol2025" : "vol2026Ytd"], c3: row.history?.[period === "2025" ? "c32025" : "c32026Ytd"], investment: historyInvestment(row.history, period), yield: historyYield(row.history, period), count: row.initiatives.size })[sort.key] ?? row[sort.key];
      const av = value(a), bv = value(b);
      if (av == null) return bv == null ? 0 : 1;
      if (bv == null) return -1;
      return (typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), "zh-CN", { numeric: true })) * sort.direction;
    });
  return (
    <section id="studio-dealers" className="panel studio-section">
      <header>
        <span>{executive ? "④" : "⑤"}</span>
        <div>
          <h2>{executive ? "④ " : "⑤ "}经销商明细 · 投入与历史对照</h2>
          <p>
            金额为当前范围合计；历史列期间为{" "}
            {period === "2025" ? "2025 全年" : "2026 YTD（月份由数据源提供）"}。
          </p>
        </div>
      </header>
      <div className="studio-inline-controls"><label>明细历史期间<select value={period} onChange={(event) => setPeriod(event.target.value)}><option value="2025">2025 全年</option><option value="2026Ytd">2026 YTD</option></select></label><label>明细产出口径<select value={basis} onChange={(event) => setBasis(event.target.value)}><option value="c3">C3</option><option value="vol">Delivery Vol</option></select></label></div>
      <div className="studio-table-toolbar">
        <span>快速定位：占比与差值 · Actual / Phasing · 投资 / Yield</span>
        <input
          type="search"
          placeholder="搜索经销商 / 编码"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
      </div>
      <div className="table-scroll studio-wide-table">
        <table>
          <thead>
            <tr>
              {header("name", "经销商 / 编码")}
              {header("amount", "累计投资（万）")}
              {header("sd", "SD")}
              {executive && <th>Initiative</th>}
              {header("rsm", "RSM")}
              {!executive && <th>状态</th>}
              {header("amountShare", "投资占比")}
              {header("volShare", "Delivery Vol占比")}
              {header("c3Share", "C3占比")}
              {header("gap", `投资−${metricLabel(basis)}`)}
              {header("vol", "Delivery Vol（KL）")}
              {header("c3", "Actual C3（K$）")}
              <th className="num">Phasing</th>
              {header("investment", "历史投资（K$）")}
              {header("yield", "Yield")}
              {header("count", "获配项目数")}
            </tr>
          </thead>
          <tbody>
            {deviations
              .slice(
                (Math.min(
                  page,
                  Math.max(1, Math.ceil(deviations.length / 50)),
                ) -
                  1) *
                  50,
                Math.min(page, Math.max(1, Math.ceil(deviations.length / 50))) *
                  50,
              )
              .map((row) => {
                const h = row.history || {},
                  investment = historyInvestment(h, period),
                  yieldValue = historyYield(h, period),
                  delivery = period === "2025" ? h.vol2025 : h.vol2026Ytd,
                  c3 = period === "2025" ? h.c32025 : h.c32026Ytd;
                return (
                  <tr key={row.key}>
                    <td>
                      <strong>{row.name}</strong>
                      <small>{row.code || row.id}</small>
                    </td>
                    <td className="num">{num(row.amount / 10000, 1)}</td>
                    <td>{executive ? <button className="button small" onClick={() => setDetail(row)}>{row.sd}</button> : row.sd}</td>
                    {executive && <td><div className="v19-source-chips">{row.initiativeSources?.map((source) => <button key={source.id} onClick={() => setDetail(row)}>{source.name}</button>)}</div></td>}
                    <td>{row.rsm}</td>
                    {!executive && <td>
                      <span className={`resource-status ${row.status}`}>
                        {row.status}
                      </span>
                    </td>}
                    <td className="num">{pct(row.amountShare)}</td>
                    <td className="num">{pct(volShares.get(row.key))}</td>
                    <td className="num">{pct(c3Shares.get(row.key))}</td>
                    <td className="num">{pp(row.gap)}</td>
                    <td className="num">
                      {delivery == null
                        ? "—"
                        : num(historyDisplayValue(delivery), 2)}
                    </td>
                    <td className="num">
                      {c3 == null ? "—" : num(historyDisplayValue(c3), 2)}
                    </td>
                    <td
                      className="num"
                      title="历史数据未提供合同量，无法计算 Phasing"
                    >
                      —
                    </td>
                    <td className="num">
                      {investment !== null
                        ? num(historyDisplayValue(investment), 2)
                        : "—"}
                    </td>
                    <td className="num">
                      {yieldValue !== null ? `${num(yieldValue, 2)}x` : "—"}
                    </td>
                    <td className="num">{row.initiatives.size}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      <div className="table-footer">
        <span>共 {deviations.length} 家 · 每页 50 行</span>
        <div className="actions">
          <button
            className="button small"
            disabled={page <= 1}
            onClick={() => setPage((value) => value - 1)}
          >
            上一页
          </button>
          <span>
            {Math.min(page, Math.max(1, Math.ceil(deviations.length / 50)))} /{" "}
            {Math.max(1, Math.ceil(deviations.length / 50))}
          </span>
          <button
            className="button small"
            disabled={page >= Math.ceil(deviations.length / 50)}
            onClick={() => setPage((value) => value + 1)}
          >
            下一页
          </button>
        </div>
      </div>
      <p className="studio-table-note">
        Yield
        读取对应期间的历史数据；历史投资合计为公共指标，费用明细按当前账号权限展示。
        合同量未提供，Phasing 暂显示 —；缺失值不按 0 处理。
      </p>
      {detail && <WorkflowDialog title={`${detail.name} · 已确认投资来源`} onClose={() => setDetail(null)}><p>{detail.sd} · {detail.rsm} · 合计 {wan(detail.amount)}</p><table><thead><tr><th>Initiative</th><th>Owner</th><th className="num">投入（元）</th></tr></thead><tbody>{detail.initiativeSources?.map((source) => <tr key={source.id}><td>{source.name}</td><td>{source.owner}</td><td className="num">{num(source.amount, 2)}</td></tr>)}</tbody></table></WorkflowDialog>}
    </section>
  );
}

function PortfolioDashboard({ mode }) {
  const { view, state, data, identity } = useWorkbench();
  const accessible = new Set((view.initiatives || []).map((item) => item.id));
  const published = latestPublished(state).filter(
    (item) => mode === "exec" || accessible.has(item.id),
  );
  const source = state.planningVersion ? (view.initiatives || []).filter((item) => mode === "owner" || (mode === "exec" ? true : item.workflow?.submitted)) : mode === "owner" ? view.initiatives || [] : published;
  const [filters, setFilters] = useState({
    sector: "all",
    department: "all",
    resourceType: "all",
    name: "all",
  });
  const [basis, setBasis] = useState("c3"),
    [period, setPeriod] = useState("2025");
  const scoped = source.filter((item) =>
    Object.entries(filters).every(
      ([key, value]) => value === "all" || item[key] === value,
    ),
  );
  const rows = useMemo(
    () => portfolioRows(scoped, data.dealers, basis, period),
    [scoped, data.dealers, basis, period],
  );
  const total = E.totals(scoped),
    executive = mode === "exec";
  const title = executive
    ? "全局投资看板"
    : mode === "owner"
      ? "我的投入组合"
      : "部门投入组合";
  const description = executive
    ? "从资源大类往下看：预算分到哪类资源、是否集中、叠加后谁超配。只读，基于部门已确认方案。"
    : mode === "owner"
      ? "本人全部 Initiative 的工作草稿叠加分析。"
      : "本部门已提交方案，只读查看预算去向与历史产出匹配。";
  const anchors = [
    ["studio-total", "① 总盘"],
    ["studio-health", executive ? "② 集中度" : "② 健康检查"],
    ["studio-destination", "③ 投资分配去向"],
    ...(!executive ? [["studio-structure", "④ 按 SD 看"]] : []),
    ["studio-dealers", executive ? "④ 经销商明细" : "⑤ 经销商明细"],
    ["studio-version-change", executive ? "⑤ 版本变化" : "⑥ 版本变化"],
  ];
  return (
    <>
      <PageHead
        eyebrow={
          executive
            ? "EXECUTIVE / RESOURCE ALLOCATION"
            : mode === "owner"
              ? "OWNER / PORTFOLIO"
              : "DEPARTMENT / PORTFOLIO"
        }
        title={title}
        description={description}
      />
      <VersionBar />
      <BoardFilters
        items={source}
        filters={filters}
        setFilters={setFilters}
        executive={executive}
      />
      <nav className="studio-section-nav" aria-label="页面内导航">
        {anchors.map(([id, label]) => (
          <a key={id} href={`#${id}`}>
            {label}
          </a>
        ))}
      </nav>
      <TotalSection items={scoped} rows={rows} total={total} mode={mode} />
      <HealthSection
        rows={rows}
        basis={basis}
        setBasis={setBasis}
        period={period}
        setPeriod={setPeriod}
        executive={executive}
      />
      <DestinationSection items={scoped} executive={executive} />
      {!executive && (
        <SdAnalysis items={scoped} dealers={data.dealers} showOwner={mode === "department"} metadata={state.reference} threshold={state.healthThresholds?.dealerYellow ?? 3} sourceVersionId={state.planningVersion?.sourceVersionId} comparisonIdentity={identity?.email} />
      )}
      <DealerSection items={scoped} dealers={data.dealers} executive={executive} />
      <VersionComparison executive={executive} />
      <p className="studio-board-footnote">
        集中度高不代表不合理，需结合 Owner
        说明判断；无历史的新经销商不参与产出匹配比较。
      </p>
    </>
  );
}

export function DepartmentPage() {
  const { identity } = useWorkbench();
  return (
    <PortfolioDashboard
      mode={identity.role === "owner" ? "owner" : "department"}
    />
  );
}
export function ManagementPage() {
  return <PortfolioDashboard mode="exec" />;
}
