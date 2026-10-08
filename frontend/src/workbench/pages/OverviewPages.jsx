import { useState } from "react";
import { useWorkbench } from "../WorkbenchContext.jsx";
import E from "../domain/engine.js";

const fmt = (n) =>
  Number(n || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const pct = (n, d) => (d ? ((n / d) * 100).toFixed(2) : "0.00");
const time = (v) =>
  v
    ? new Date(v).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const latest = (items) =>
  items
    .map((i) => i.publishedAt)
    .filter(Boolean)
    .sort()
    .at(-1);
const pending = (i) => !i.publishedAt || i.publishedRevision !== i.revision;
const names = { MKT: "市场部", ICE: "ICE 部门", CAPEX: "资本投入组" };
export function PageHead({ title, description, children }) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="actions">{children}</div>
    </div>
  );
}
function Metrics({ entries }) {
  return (
    <section className="metric-grid" aria-label="关键指标">
      {entries.map(([label, value, note, progress, tone]) => (
        <article
          key={label}
          className={`metric-card ${tone ? `metric-${tone}` : ""}`}
        >
          <h2 className="metric-label">{label}</h2>
          <div
            className={`metric-value ${label === "最新同步" ? "metric-status" : ""}`}
          >
            <strong>{value}</strong>
          </div>
          <div className="metric-footer">
            <p className="metric-note">{note}</p>
            {progress !== undefined && (
              <div className="metric-progress">
                <span
                  style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
                />
              </div>
            )}
          </div>
        </article>
      ))}
    </section>
  );
}
function Composition({ total: t, label = "预算分配" }) {
  const { state } = useWorkbench();
  const amounts = new Map(
    (t.otherBudgetByReason || []).map((r) => [r.reasonId, r.amount]),
  );
  const ids = [
    ...new Set([
      ...(state.budgetReasons || [])
        .filter((r) => r.enabled || amounts.has(r.id))
        .map((r) => r.id),
      ...amounts.keys(),
    ]),
  ];
  const colors = [
    "#16866b",
    "#0066b3",
    "#a46b35",
    "#557faa",
    "#748951",
    "#9b7081",
  ];
  const parts = [
    ["经销商", t.allocated, "#ffcd00"],
    ...ids.map((id, n) => [
      state.budgetReasons.find((r) => r.id === id)?.label || id,
      amounts.get(id) || 0,
      colors[n % colors.length],
    ]),
    ["未安排", Math.max(0, t.gap), "#dde4ed"],
  ];
  const used = t.allocated + t.otherBudget,
    scale = Math.max(t.budget, used, 1);
  return (
    <section
      className={`budget-composition ${t.gap < 0 ? "is-over" : ""}`}
      aria-label="预算分配占比"
    >
      <div className="composition-heading">
        <span>
          {label} <small>金额 · 占当前范围预算</small>
        </span>
        <strong>
          {t.budget > 0 ? `已安排 ${pct(used, t.budget)}%` : "暂无预算"}
          {t.gap < 0 && ` · 超出 ${fmt(-t.gap)}`}
        </strong>
      </div>
      <div
        className="composition-track"
        role="img"
        aria-label={parts
          .map(
            ([name, amount]) =>
              `${name} ${fmt(amount)}，占预算 ${pct(amount, t.budget)}%`,
          )
          .join("；")}
      >
        {parts.map(([name, amount, color]) => (
          <span
            key={name}
            className="composition-segment"
            style={{ width: `${(amount / scale) * 100}%`, background: color }}
            title={`${name} ${fmt(amount)} · ${pct(amount, t.budget)}%`}
          />
        ))}
      </div>
      <div className="composition-legend">
        {parts.map(([name, amount, color]) => (
          <span key={name}>
            <i style={{ background: color }} />
            {name} <b>{fmt(amount)}</b>
            <small>{pct(amount, t.budget)}%</small>
          </span>
        ))}
        {t.gap < 0 && (
          <span className="composition-warning">
            超配时条形按已安排金额展示
          </span>
        )}
      </div>
      {t.gap < 0 && (
        <div className="allocation-over-alert" role="note">
          <div>
            <strong>已超出预算 {fmt(-t.gap)}</strong>
            <span>请减少分配金额，配平后才能同步最新分配。</span>
          </div>
        </div>
      )}
    </section>
  );
}
function InitiativeTable({ items, owner = false }) {
  const { state, identity, navigate, openAuxiliary } = useWorkbench();
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Initiative / 资源类型</th>
            <th>Sector</th>
            {owner && <th>Marketer</th>}
            <th className="num">预算金额</th>
            <th className="num">经销商分配</th>
            <th>最新同步时间</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id}>
              <td>
                <div className="table-name">{i.name}</div>
                <div className="table-sub">
                  {i.resourceType} · {i.id.replace("initiative-", "I-")}
                </div>
              </td>
              <td>{i.sector}</td>
              {owner && <td>{i.ownerId}</td>}
              <td className="num">{fmt(i.budget)}</td>
              <td className="num">
                {fmt(E.totals([i]).allocated)}
                <div className="allocation-share-text">
                  {pct(E.totals([i]).allocated, i.budget)}%{" "}
                  <span>占本项预算</span>
                </div>
              </td>
              <td>
                {i.publishedAt ? (
                  <>
                    <span>{time(i.publishedAt)}</span>
                    <div className="table-sub">
                      {pending(i)
                        ? "本地有新调整，待同步"
                        : "已同步最新分配 · 可继续修改"}
                    </div>
                  </>
                ) : (
                  <span className="muted">尚未同步</span>
                )}
              </td>
              <td className="action-cell">
                <button
                  className="button link"
                  onClick={() => navigate("editor", i.id)}
                >
                  {E.canEdit(state, i.id, identity)
                    ? "查看 / 调整"
                    : "查看明细"}
                </button>
                {identity.role === "owner" && (
                  <button
                    className="button link"
                    onClick={() =>
                      openAuxiliary("insight", `initiative:${i.id}`)
                    }
                  >
                    Insight
                  </button>
                )}
              </td>
            </tr>
          ))}
          {!items.length && (
            <tr>
              <td colSpan={owner ? 7 : 6}>
                <div className="empty">没有匹配的 Initiative。</div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
export function HomePage() {
  const { view, identity, navigate, openAuxiliary, apiMode } = useWorkbench();
  const [search, setSearch] = useState(""),
    [sector, setSector] = useState("all"),
    [status, setStatus] = useState("all");
  const items = view.initiatives,
    t = E.totals(items),
    todo = items.filter(pending),
    next = todo[0] || items[0],
    unbalanced = items.filter((i) => E.totals([i]).gap !== 0).length;
  const rows = items.filter(
    (i) =>
      `${i.name} ${i.resourceType} ${i.id}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (sector === "all" || i.sector === sector) &&
      (status === "all" || (status === "pending" ? pending(i) : !pending(i))),
  );
  return (
    <>
      <PageHead
        title="我的工作台"
        description="分配可随时调整。同步后更新共享版本，管理层查看每项最新一次同步的数据。"
      >
        <button
          className="button"
          onClick={() => openAuxiliary("insight", `owner:${identity.ownerId}`)}
        >
          我的 Insight
        </button>
      </PageHead>
      <Metrics
        entries={[
          [
            "负责预算",
            fmt(t.budget),
            `${items.length} 项 Initiative · 2027 计划`,
          ],
          [
            "已分配到经销商",
            fmt(t.allocated),
            `占负责预算 ${pct(t.allocated, t.budget)}%`,
            t.budget ? (t.allocated / t.budget) * 100 : 0,
          ],
          [
            "未解释差额",
            fmt(t.gap),
            unbalanced ? `${unbalanced} 项待配平` : "各项预算已平衡",
            undefined,
            unbalanced ? "warn" : "success",
          ],
        ]}
      />
      <Composition total={t} />
      {next && (
        <div className="focus-banner">
          <div>
            <strong>
              {todo.length ? `${todo.length} 项有待同步的调整` : "全部已同步"}
            </strong>
            <p>
              {todo.length
                ? next.name
                : "仍可继续修改，再次同步即可更新共享版本。"}
            </p>
          </div>
          <button
            className="button primary"
            onClick={() => navigate("editor", next.id)}
          >
            继续配置
          </button>
        </div>
      )}
      <section className="panel initiative-panel">
        <div className="panel-header">
          <h2>
            我的 Initiative <small>{items.length} 项</small>
          </h2>
          <span className="muted small-text">{identity.ownerId}</span>
        </div>
        <div className="filters">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索 Initiative / 资源类型"
            aria-label="搜索 Initiative"
          />
          <select
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            aria-label="按 Sector 筛选"
          >
            <option value="all">所有 Sector</option>
            {[...new Set(items.map((i) => i.sector))].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="按同步状态筛选"
          >
            <option value="all">所有同步状态</option>
            <option value="pending">待同步</option>
            <option value="published">已同步最新</option>
          </select>
        </div>
        <InitiativeTable items={rows} />
        <div className="table-footer">
          {apiMode
            ? "修改后请保存草稿 · 每项可重复同步 · 只更新自己的 Initiative"
            : "修改即时保存在本机 · 每项可重复同步 · 只更新自己的 Initiative"}
        </div>
      </section>
    </>
  );
}
export function DepartmentPage() {
  const { view, identity, openAuxiliary } = useWorkbench(),
    own = identity.role === "owner",
    dep = identity.department,
    items = view.initiatives.filter((i) => i.department === dep),
    t = own ? view.summaries[dep] : E.totals(items);
  if (!t) return <div className="empty">当前角色无权查看部门工作稿。</div>;
  return (
    <>
      <PageHead
        title={`${dep} · 部门总览`}
        description={
          own
            ? "查看本部门预算汇总；下方仅展示你负责的 Initiative。"
            : "查看本部门最新工作稿与同步时间，Marketer 可自行持续更新。"
        }
      />
      <Metrics
        entries={[
          [
            "部门预算",
            fmt(t.budget),
            `${own ? t.initiativeCount : items.length} 项 Initiative`,
          ],
          [
            "经销商分配",
            fmt(t.allocated),
            own
              ? "本部门当前工作稿"
              : `占部门预算 ${pct(t.allocated, t.budget)}%`,
          ],
          own
            ? [
                "经销商分配率",
                `${pct(t.allocated, t.budget)}%`,
                "经销商分配 ÷ 部门预算",
                t.budget ? (t.allocated / t.budget) * 100 : 0,
              ]
            : [
                "最新同步",
                time(latest(items)),
                "各项由负责的 Marketer 独立同步",
              ],
        ]}
      />
      <Composition total={t} />
      <section className="panel">
        <div className="panel-header">
          <h2>
            {own ? "我的 Initiative" : "部门 Initiative"}{" "}
            <small>{items.length} 项</small>
          </h2>
          {!own && (
            <button
              className="button small"
              onClick={() => openAuxiliary("insight", dep)}
            >
              查看部门 Insight
            </button>
          )}
        </div>
        <InitiativeTable items={items} owner={!own} />
        {!own && (
          <div className="table-footer">
            本部门明细只读 · 分配由各 Marketer 维护
          </div>
        )}
      </section>
    </>
  );
}
export function ManagementPage() {
  const { view } = useWorkbench(),
    items = view.initiatives,
    t = E.totals(items);
  const [filters, setFilters] = useState({
      department: "all",
      sector: "all",
      resourceType: "all",
      name: "all",
    }),
    [sort, setSort] = useState({ key: "budget", direction: "desc" });
  const totals = Object.fromEntries(
    E.DEPARTMENTS.map((dep) => [
      dep,
      E.totals(items.filter((i) => i.department === dep)),
    ]),
  );
  const cards = [
    ...E.DEPARTMENTS.map((dep) => ({
      label: dep,
      name: names[dep],
      items: items.filter((i) => i.department === dep),
      total: totals[dep],
      count: view.departments[dep]?.totalInitiativeCount || 0,
    })),
    {
      label: "全部部门",
      name: "最新同步汇总",
      items,
      total: t,
      count: E.DEPARTMENTS.reduce(
        (n, d) => n + (view.departments[d]?.totalInitiativeCount || 0),
        0,
      ),
    },
  ];
  const value = (i, key) =>
    key === "share"
      ? i.budget / (totals[i.department].budget || 1)
      : key === "allocated"
        ? E.totals([i]).allocated
        : (i[key] ?? "");
  const rows = items
    .filter((i) =>
      Object.entries(filters).every(([key, v]) => v === "all" || i[key] === v),
    )
    .sort((a, b) => {
      const x = value(a, sort.key),
        y = value(b, sort.key);
      return (
        (typeof x === "number"
          ? x - y
          : String(x).localeCompare(String(y), "zh-CN")) *
          (sort.direction === "asc" ? 1 : -1) || a.id.localeCompare(b.id)
      );
    });
  const headings = [
    ["department", "部门"],
    ["sector", "Sector"],
    ["resourceType", "资源类型"],
    ["name", "Initiative"],
    ["share", "占部门预算"],
    ["budget", "预算金额"],
    ["allocated", "经销商金额"],
    ["publishedAt", "最新同步"],
  ];
  return (
    <>
      <PageHead
        title="管理层统览"
        description="汇总各 Marketer 最新同步的数据；如需调整，请线下联系管理员。"
      />
      <div className="management-caption">
        最新更新时间：<strong>{time(latest(items))}</strong>
        <span>{items.length} 项已同步 Initiative · 未同步草稿不纳入</span>
      </div>
      <section className="management-metrics" aria-label="部门预算汇总">
        {cards.map((c) => (
          <article
            key={c.label}
            className={`management-card ${c.label === "全部部门" ? "is-total" : ""}`}
          >
            <div className="management-card-title">
              <h2>{c.label}</h2>
              <span>{c.name}</span>
            </div>
            <label>已同步预算</label>
            <strong>{fmt(c.total.budget)}</strong>
            <div className="management-card-detail">
              <span>分配到经销商</span>
              <b>{fmt(c.total.allocated)}</b>
            </div>
            <div className="management-card-detail">
              <span>经销商分配率</span>
              <b>{pct(c.total.allocated, c.total.budget)}%</b>
            </div>
            <div className="metric-progress">
              <span
                style={{
                  width: `${Math.min(100, (c.total.allocated / (c.total.budget || 1)) * 100)}%`,
                }}
              />
            </div>
            <small>
              已同步 {c.items.length} / {c.count} 项 · {time(latest(c.items))}
            </small>
          </article>
        ))}
      </section>
      <section className="panel management-detail">
        <div className="panel-header">
          <h2>
            Initiative 明细{" "}
            <small>
              {rows.length} / {items.length} 项
            </small>
          </h2>
          <span className="small-text muted">点击表头切换排序</span>
        </div>
        <div className="management-filters">
          {headings.slice(0, 4).map(([key, label]) => (
            <label key={key}>
              {label}
              <select
                aria-label={`按${label}筛选`}
                value={filters[key]}
                onChange={(e) =>
                  setFilters({ ...filters, [key]: e.target.value })
                }
              >
                <option value="all">全部{label}</option>
                {[...new Set(items.map((i) => i[key]))]
                  .sort((a, b) => a.localeCompare(b, "zh-CN"))
                  .map((x) => (
                    <option key={x}>{x}</option>
                  ))}
              </select>
            </label>
          ))}
        </div>
        <div className="management-distribution">
          <Composition
            total={E.totals(rows)}
            label="当前筛选 · 已同步预算分布"
          />
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {headings.map(([key, label]) => (
                  <th
                    key={key}
                    aria-sort={
                      sort.key === key
                        ? sort.direction === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                    className={
                      ["share", "budget", "allocated"].includes(key)
                        ? "num"
                        : ""
                    }
                  >
                    <button
                      className="table-sort"
                      onClick={() =>
                        setSort({
                          key,
                          direction:
                            sort.key === key && sort.direction === "desc"
                              ? "asc"
                              : "desc",
                        })
                      }
                    >
                      {label}
                      <span aria-hidden="true">
                        {sort.key === key
                          ? sort.direction === "asc"
                            ? "↑"
                            : "↓"
                          : "↕"}
                      </span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id}>
                  <td>
                    <b>{i.department}</b>
                  </td>
                  <td>{i.sector}</td>
                  <td>{i.resourceType}</td>
                  <td>
                    <b>{i.name}</b>
                    <div className="table-sub">
                      {i.id} · {i.ownerId}
                    </div>
                  </td>
                  <td className="num">
                    {pct(i.budget, totals[i.department].budget)}%
                  </td>
                  <td className="num">{fmt(i.budget)}</td>
                  <td className="num">{fmt(E.totals([i]).allocated)}</td>
                  <td>{time(i.publishedAt)}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={8}>
                    <div className="empty">
                      暂无符合条件的已同步 Initiative。
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="table-footer">
          卡片分配率 = 经销商金额 ÷ 已同步预算；明细占比 = 本项预算 ÷
          所属部门全部已同步预算。筛选不改变分母。
        </div>
      </section>
    </>
  );
}
