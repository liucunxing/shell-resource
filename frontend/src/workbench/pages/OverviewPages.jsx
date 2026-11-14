import { useMemo, useState } from "react";
import { useWorkbench } from "../WorkbenchContext.jsx";
import E from "../domain/engine.js";
import {
  historyDisplayValue,
  historyInvestment,
  historyYield,
} from "../domain/dealer-history";
import {
  concentration,
  dealerDeviations,
  groupSummary,
  level,
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
const versions = [
  ["202612", "年度初始规划"],
  ["202701", "业务目标校准"],
];

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

function VersionBar() {
  const [version, setVersion] = useState("202701");
  return (
    <div className="studio-version-bar">
      <label>
        2027 OP · 工作版本
        <select
          value={version}
          onChange={(event) => setVersion(event.target.value)}
        >
          {versions.map(([id, name]) => (
            <option key={id} value={id}>
              {id} · {name}
            </option>
          ))}
        </select>
      </label>
      <span className="resource-status done">开放提交</span>
      <small>清单、预算、Owner、草稿均按版本独立</small>
    </div>
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
  const [sector, setSector] = useState("all"),
    [department, setDepartment] = useState("all");
  const items = view.initiatives || [];
  const options = (key) => [
    ...new Set(items.map((item) => item[key]).filter(Boolean)),
  ];
  const filtered = items.filter(
    (item) =>
      (sector === "all" || item.sector === sector) &&
      (department === "all" || item.department === department),
  );
  const total = E.totals(filtered);
  return (
    <>
      <PageHead
        eyebrow="OWNER / MY INITIATIVES"
        title="预算分到哪里，还有多少没分？"
        description="选择 Initiative 进入三步拆分：预算与预留、经销商范围、试算微调与提交。"
      />
      <VersionBar />
      <section className="studio-filter-row panel">
        <label>
          Sector
          <select
            value={sector}
            onChange={(event) => setSector(event.target.value)}
          >
            <option value="all">全部</option>
            {options("sector").map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Department
          <select
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
          >
            <option value="all">全部</option>
            {options("department").map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      </section>
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
          ["预留", wan(total.reserve), "有原因、暂不分配"],
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
                    width: `${Math.min(100, item.budget ? ((totals.allocated + totals.reserve) / item.budget) * 100 : 0)}%`,
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
                  <dd>{wan(totals.reserve)}</dd>
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
  const { view, navigate, publish, savedForSyncIds, editorOperations } =
    useWorkbench();
  const items = view.initiatives || [];
  const ready = items.filter((item) => savedForSyncIds.has(item.id));
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
            <h2>202701 · 当前 Owner</h2>
            <p className="muted">
              提交覆盖仅限当前版本选中的项目，保留修订审计。
            </p>
          </div>
          <button
            className="button primary"
            disabled={!ready.length}
            onClick={async () => {
              for (const item of ready) await publish(item.id);
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
                    <td className="num">{num(totals.reserve / 10000, 1)}</td>
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
function signal(gap) {
  const tone = level(gap);
  return [
    tone,
    tone === "bad"
      ? "优先关注"
      : tone === "warn"
        ? "建议复核"
        : tone === "good"
          ? "匹配"
          : "无历史",
  ];
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
  return (
    <section id="studio-total" className="panel studio-section">
      <header>
        <span>①</span>
        <div>
          <h2>总盘 · 预算有多少，分下去多少</h2>
          <p>预算 = 已分配到经销商 + 预留 + 未提交</p>
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
          ["预留", wan(total.reserve), "有原因、暂不分配"],
          [
            mode === "owner" ? "待分配" : "未提交",
            wan(unsubmitted),
            unsubmitted ? "仍需处理" : "当前范围已完成",
            unsubmitted ? "warn" : "success",
          ],
        ]}
      />
      <div className="studio-budget-flow">
        {[
          ["已分配到经销商", total.allocated],
          ["预留", total.reserve],
          [mode === "owner" ? "待分配" : "未提交", unsubmitted],
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
  const label = metricLabel(basis),
    summaries = [20, 50, 80].map((top) => [top, concentration(rows, top)]),
    deviations = dealerDeviations(rows),
    over = deviations.filter((row) => row.gap > 3).length;
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
            <option value="2026Ytd">2026 YTD（1–10月）</option>
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
                    <b className={result?.gap > 10 ? "negative" : ""}>
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
          <strong>{over} 家经销商超配 &gt;3pp</strong>
          <p>
            差值 &gt;3pp 提示复核，&gt;6pp
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
              <th>{executive ? "资源大类" : "Initiative"}</th>
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
                <td className="num">{num(group.total.budget / 10000, 1)}</td>
                <td className="num">{num(group.total.allocated / 10000, 1)}</td>
                <td className="num">{num(group.total.reserve / 10000, 1)}</td>
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

function StructureSection({ rows, dealers, basis }) {
  const groups = groupSummary(rows, dealers, "sd"),
    label = metricLabel(basis);
  return (
    <section id="studio-structure" className="panel studio-section">
      <header>
        <span>④</span>
        <div>
          <h2>按 SD 看 · 各 SD 分得是否均衡</h2>
          <p>投入金额占比与 {label} 占比在同一完整范围内比较。</p>
        </div>
      </header>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>SD</th>
              <th className="num">获配 / 全部</th>
              <th className="num">投资金额（万）</th>
              <th className="num">投资占比</th>
              <th className="num">{label} 占比</th>
              <th className="num">差值</th>
              <th>判断</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const [tone, text] = signal(group.gap);
              return (
                <tr key={group.key}>
                  <td>
                    <strong>{group.key}</strong>
                  </td>
                  <td className="num">
                    {group.allocatedCount} / {group.totalCount}
                  </td>
                  <td className="num">{num(group.amount / 10000, 1)}</td>
                  <td className="num">{pct(group.amountShare)}</td>
                  <td className="num">{pct(group.metricShare)}</td>
                  <td className="num">{pp(group.gap)}</td>
                  <td>
                    <span className={`resource-signal ${tone}`}>{text}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DealerSection({ rows, basis, period, executive }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
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
    );
  return (
    <section id="studio-dealers" className="panel studio-section">
      <header>
        <span>{executive ? "④" : "⑤"}</span>
        <div>
          <h2>{executive ? "④ " : "⑤ "}经销商明细 · 投入与历史对照</h2>
          <p>
            金额为当前范围合计；历史列期间为{" "}
            {period === "2025" ? "2025 全年" : "2026 YTD（1–10月）"}。
          </p>
        </div>
      </header>
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
              <th>经销商 / 编码</th>
              <th className="num">累计投资（万）</th>
              <th>SD</th>
              <th>RSM</th>
              <th>状态</th>
              <th className="num">投资占比</th>
              <th className="num">Delivery Vol占比</th>
              <th className="num">C3占比</th>
              <th className="num">投资−{metricLabel(basis)}</th>
              <th className="num">Delivery Vol（KL）</th>
              <th className="num">Actual C3（K$）</th>
              <th className="num">Phasing</th>
              <th className="num">历史投资（K$）</th>
              <th className="num">Yield</th>
              <th className="num">获配项目数</th>
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
                    <td>{row.sd}</td>
                    <td>{row.rsm}</td>
                    <td>
                      <span className={`resource-status ${row.status}`}>
                        {row.status}
                      </span>
                    </td>
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
        读取对应期间的历史数据；历史投资仅在四类资源均可见且数据完整时展示。
        合同量未提供，Phasing 暂显示 —；缺失值不按 0 处理。
      </p>
    </section>
  );
}

function VersionSection({ executive }) {
  return (
    <section
      id="studio-version-change"
      className="panel studio-section studio-version-compare"
    >
      <header>
        <span>{executive ? "⑤" : "⑥"}</span>
        <div>
          <h2>{executive ? "⑤ " : "⑥ "}版本变化 · 202701 对比 202612</h2>
          <p>默认当前版本对比来源版本，也可选择任意两个已发布版本。</p>
        </div>
      </header>
      <div className="studio-inline-controls">
        <label>
          版本 A
          <select>
            <option>202612 · 年度初始规划</option>
          </select>
        </label>
        <span>→</span>
        <label>
          版本 B
          <select>
            <option>202701 · 业务目标校准</option>
          </select>
        </label>
      </div>
      <div className="empty">选择范围后展示预算去向与经销商投入变化。</div>
    </section>
  );
}

function PortfolioDashboard({ mode }) {
  const { view, state, data } = useWorkbench();
  const accessible = new Set((view.initiatives || []).map((item) => item.id));
  const published = latestPublished(state).filter(
    (item) => mode === "exec" || accessible.has(item.id),
  );
  const source = mode === "owner" ? view.initiatives || [] : published;
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
    ? "从资源大类往下看：预算分到哪类资源、是否集中、叠加后谁超配。只读，基于已提交方案。"
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
        <StructureSection rows={rows} dealers={data.dealers} basis={basis} />
      )}
      <DealerSection
        rows={rows}
        basis={basis}
        period={period}
        executive={executive}
      />
      <VersionSection executive={executive} />
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
