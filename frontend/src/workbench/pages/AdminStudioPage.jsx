import { useMemo, useState } from "react";
import { useWorkbench } from "../WorkbenchContext.jsx";
import E from "../domain/engine.js";
import { PageHead } from "./OverviewPages.jsx";

const num = (value, digits = 1) =>
  Number(value || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
const time = (value) => (value ? new Date(value).toLocaleString("zh-CN") : "—");
const ADMIN_META = {
  "admin-versions": [
    "ADMINISTRATION / VERSIONS",
    "版本与发布",
    "创建、发布规划版本；控制开放 / 关闭提交",
  ],
  "admin-initiatives": [
    "ADMINISTRATION / INITIATIVES",
    "本版项目配置",
    "每个版本独立维护 Initiative 清单、预算、资源大类与 Owner",
  ],
  "admin-users": [
    "ADMINISTRATION / ACCESS",
    "用户与权限",
    "维护登录账号、角色和 Sector / Department 数据范围",
  ],
  "admin-enums": [
    "ADMINISTRATION / ENUMS",
    "组织与枚举",
    "维护 Sector、Department、资源大类和历史数据期间",
  ],
  "admin-thresholds": [
    "ADMINISTRATION / HEALTH RULES",
    "健康检查阈值",
    "配置集中度和经销商超配 / 低配的提醒阈值",
  ],
  "admin-audit": [
    "ADMINISTRATION / AUDIT",
    "操作审计",
    "查看版本、配置、草稿和提交的关键操作记录",
  ],
};

function VersionBar() {
  return (
    <div className="studio-version-bar">
      <label>
        当前配置版本
        <select defaultValue="202701">
          <option value="202612">202612 · 年度初始规划</option>
          <option value="202701">202701 · 业务目标校准</option>
        </select>
      </label>
      <span className="resource-status done">已发布 · 开放提交</span>
      <small>版本间清单、预算、Owner、草稿相互独立</small>
    </div>
  );
}

function VersionsPage({ items, notify }) {
  const total = E.totals(items);
  const [creating, setCreating] = useState(false),
    [versionId, setVersionId] = useState("202702"),
    [name, setName] = useState("");
  return (
    <section className="panel studio-admin-panel">
      <div className="panel-header">
        <div>
          <h2>规划版本</h2>
          <p>新版本复制清单与上一版已提交方案为草稿，不自动提交。</p>
        </div>
        <button className="button primary" onClick={() => setCreating(true)}>
          ＋ 从上版创建新版本
        </button>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>版本 / 来源</th>
              <th>名称</th>
              <th className="num">启用项目</th>
              <th className="num">总预算（万）</th>
              <th>发布 / 提交状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>202612</strong>
                <small>来源 初始</small>
              </td>
              <td>年度初始规划</td>
              <td className="num">{items.length}</td>
              <td className="num">{num(total.budget / 10000)}</td>
              <td>
                <span className="resource-status done">已发布</span>{" "}
                <span className="resource-status done">开放提交</span>
              </td>
              <td>
                <button className="button small">配置项目</button>{" "}
                <button className="button small">关闭提交</button>
              </td>
            </tr>
            <tr>
              <td>
                <strong>202701</strong>
                <small>来源 202612</small>
              </td>
              <td>业务目标校准</td>
              <td className="num">{items.length}</td>
              <td className="num">{num(total.budget / 10000)}</td>
              <td>
                <span className="resource-status done">已发布</span>{" "}
                <span className="resource-status done">开放提交</span>
              </td>
              <td>
                <button className="button small">配置项目</button>{" "}
                <button className="button small">关闭提交</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {creating && (
        <div className="studio-inline-form">
          <h3>从 202701 创建新版本</h3>
          <label>
            版本 ID
            <input
              value={versionId}
              onChange={(event) =>
                setVersionId(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
            />
          </label>
          <label>
            版本名称
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：二季度业务校准"
            />
          </label>
          <div className="actions">
            <button className="button" onClick={() => setCreating(false)}>
              取消
            </button>
            <button
              className="button primary"
              disabled={versionId.length !== 6 || !name.trim()}
              onClick={() => {
                setCreating(false);
                notify("版本创建尚未接入服务端，本次未保存。", true);
              }}
            >
              创建版本
            </button>
          </div>
        </div>
      )}
      <p className="studio-table-note">
        预算改变后不自动缩放；新增项目从零开始；取消项目保留稳定编码与历史实际。
      </p>
    </section>
  );
}

function InitiativesPage({
  items,
  identity,
  roles,
  apiMode,
  mutate,
  manageAdminBudget,
  notify,
}) {
  const [query, setQuery] = useState(""),
    [editing, setEditing] = useState(null),
    [busy, setBusy] = useState(false);
  const filtered = items.filter((item) =>
    `${item.id} ${item.name} ${item.ownerId}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const open = (item = null) =>
    setEditing(
      item
        ? { ...item, budgetWan: item.budget / 10000 }
        : {
            id: "",
            name: "",
            sector: "PCMO",
            department: "MKT",
            resourceType: "MRD",
            ownerId: "",
            budgetWan: 0,
            enabled: true,
          },
    );
  const save = async () => {
    const payload = {
      id: editing.id,
      name: editing.name.trim(),
      sector: editing.sector,
      department: editing.department,
      resourceType: editing.resourceType,
      ownerId: editing.ownerId,
      budget: Math.round(Number(editing.budgetWan) * 10000),
      enabled: editing.enabled !== false,
    };
    if (!payload.id || !payload.name || !payload.ownerId || payload.budget < 0)
      return notify("请完整填写编码、名称、Owner 与非负预算。", true);
    setBusy(true);
    try {
      if (apiMode)
        await manageAdminBudget(
          items.some((item) => item.id === editing.id) ? "edit" : "create",
          editing,
          payload,
        );
      else
        mutate((draft) => {
          const exists = draft.initiatives.some(
            (item) => item.id === editing.id,
          );
          if (exists)
            E.editAdminBudget(draft, editing.id, payload, identity, roles);
          else E.applyAdminConfiguration(draft, [], identity, roles, [payload]);
        }, "本版项目配置已更新。");
      setEditing(null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <VersionBar />
      <section className="panel studio-admin-panel">
        <div className="panel-header">
          <div>
            <h2>202701 · 项目清单与预算</h2>
            <p>
              {items.length} 项 · 总预算 {num(E.totals(items).budget / 10000)}{" "}
              万
            </p>
          </div>
          <button className="button primary" onClick={() => open()}>
            ＋ 本版新增 Initiative
          </button>
        </div>
        <div className="studio-table-toolbar">
          <input
            type="search"
            placeholder="搜索编码 / Initiative / Owner"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <span>
            显示 {filtered.length} / {items.length} 项
          </span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>编码 / Initiative</th>
                <th>Sector / 部门</th>
                <th>Resource Type</th>
                <th>Owner</th>
                <th className="num">预算（万）</th>
                <th>本版状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.name}</strong>
                    <small>{item.id}</small>
                  </td>
                  <td>
                    {item.sector}
                    <small>{item.department}</small>
                  </td>
                  <td>{item.resourceType}</td>
                  <td>{item.ownerId}</td>
                  <td className="num">{num(item.budget / 10000)}</td>
                  <td>
                    <span className="resource-status done">启用</span>
                  </td>
                  <td>
                    <button className="button small" onClick={() => open(item)}>
                      编辑
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {editing && (
        <div className="studio-inline-form studio-admin-editor">
          <h3>
            {items.some((item) => item.id === editing.id)
              ? "编辑 Initiative"
              : "本版新增 Initiative"}
          </h3>
          {[
            ["编码", "id"],
            ["Initiative 名称", "name"],
            ["Sector", "sector"],
            ["Department", "department"],
            ["Resource Type", "resourceType"],
            ["Owner", "ownerId"],
            ["预算（万）", "budgetWan"],
          ].map(([label, key]) => (
            <label key={key}>
              {label}
              <input
                type={key === "budgetWan" ? "number" : "text"}
                value={editing[key]}
                disabled={
                  key === "id" && items.some((item) => item.id === editing.id)
                }
                onChange={(event) =>
                  setEditing({ ...editing, [key]: event.target.value })
                }
              />
            </label>
          ))}
          <div className="actions">
            <button className="button" onClick={() => setEditing(null)}>
              取消
            </button>
            <button className="button primary" disabled={busy} onClick={save}>
              {busy ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function UsersPage({ users, identity, notify }) {
  const [rows, setRows] = useState(() => (users.length ? users : [identity]));
  const [editing, setEditing] = useState(null);
  const save = () => {
    notify("新版用户编辑尚未接入服务端，本次未保存。", true);
  };
  return (
    <section className="panel studio-admin-panel">
      <div className="panel-header">
        <div>
          <h2>用户清单 · {rows.length} 人</h2>
          <p>登录仍沿用当前邮箱登录；角色与数据范围由服务端校验。</p>
        </div>
        <button
          className="button primary"
          onClick={() =>
            setEditing({
              label: "",
              email: "",
              role: "owner",
              department: "",
              enabled: true,
            })
          }
        >
          ＋ 新增用户
        </button>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>姓名</th>
              <th>登录账号</th>
              <th>角色</th>
              <th>授权范围</th>
              <th>负责 Initiative</th>
              <th>状态</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((user) => (
              <tr key={user.email || user.key}>
                <td>
                  <strong>{user.label || user.name || "—"}</strong>
                </td>
                <td>{user.email || "—"}</td>
                <td>{user.role}</td>
                <td>
                  {Array.isArray(user.department)
                    ? user.department.join("、")
                    : user.department || user.scope || "全部"}
                </td>
                <td>{user.ownerId || "—"}</td>
                <td>
                  <span
                    className={`resource-status ${user.enabled === false ? "closed" : "done"}`}
                  >
                    {user.enabled === false ? "停用" : "启用"}
                  </span>
                </td>
                <td>
                  <button
                    className="button small"
                    onClick={() => setEditing({ ...user })}
                  >
                    编辑
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <div className="studio-inline-form">
          <h3>用户与权限</h3>
          <label>
            姓名
            <input
              value={editing.label || ""}
              onChange={(event) =>
                setEditing({ ...editing, label: event.target.value })
              }
            />
          </label>
          <label>
            登录账号
            <input
              type="email"
              value={editing.email || ""}
              onChange={(event) =>
                setEditing({ ...editing, email: event.target.value })
              }
            />
          </label>
          <label>
            角色
            <select
              value={editing.role}
              onChange={(event) =>
                setEditing({ ...editing, role: event.target.value })
              }
            >
              <option value="owner">Initiative Owner</option>
              <option value="lead">部门负责人</option>
              <option value="management">最高管理层</option>
              <option value="admin">系统管理员</option>
            </select>
          </label>
          <label>
            授权范围
            <input
              value={
                Array.isArray(editing.department)
                  ? editing.department.join(",")
                  : editing.department || ""
              }
              onChange={(event) =>
                setEditing({ ...editing, department: event.target.value })
              }
            />
          </label>
          <div className="actions">
            <button className="button" onClick={() => setEditing(null)}>
              取消
            </button>
            <button
              className="button primary"
              disabled={!editing.email || !editing.label}
              onClick={save}
            >
              保存
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function EnumEditor({ title, values, setValues }) {
  const [draft, setDraft] = useState("");
  return (
    <article className="studio-enum-card">
      <h2>{title}</h2>
      <div>
        {values.map((value) => (
          <span key={value}>
            {value}
            <button
              aria-label={`移除 ${value}`}
              onClick={() => setValues(values.filter((item) => item !== value))}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <label>
        <input
          value={draft}
          placeholder="输入新值"
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          className="button small"
          disabled={!draft.trim()}
          onClick={() => {
            if (!values.includes(draft.trim()))
              setValues([...values, draft.trim()]);
            setDraft("");
          }}
        >
          ＋ 添加
        </button>
      </label>
    </article>
  );
}

function EnumsPage({ notify }) {
  const [sectors, setSectors] = useState(["PCMO", "B2B", "CRTO", "OEM"]),
    [departments, setDepartments] = useState(["MKT", "ICE", "Capex"]),
    [types, setTypes] = useState(["ICE Rebate", "MRD", "SP&A", "Capex"]),
    [cutoff, setCutoff] = useState(10);
  return (
    <>
      <div className="studio-enum-grid">
        <EnumEditor title="Sector" values={sectors} setValues={setSectors} />
        <EnumEditor
          title="Department"
          values={departments}
          setValues={setDepartments}
        />
        <EnumEditor title="资源大类" values={types} setValues={setTypes} />
        <article className="studio-enum-card">
          <h2>历史数据期间</h2>
          <p>2025 全年</p>
          <label>
            2026 YTD 截止月份
            <input
              type="number"
              min="1"
              max="12"
              value={cutoff}
              onChange={(event) => setCutoff(event.target.value)}
            />
          </label>
        </article>
        <article className="studio-enum-card">
          <h2>经销商主数据（只读）</h2>
          <p>编码、名称、SD、RSM、状态来自历史表，不能在本页修改。</p>
        </article>
      </div>
      <div className="actions studio-admin-save">
        <button
          className="button primary"
          onClick={() => notify("组织与枚举尚未接入服务端，本次未保存。", true)}
        >
          保存配置
        </button>
      </div>
    </>
  );
}

function ThresholdsPage({ notify }) {
  const [values, setValues] = useState({
    concentrationYellow: 5,
    concentrationRed: 10,
    dealerYellow: 3,
    dealerRed: 6,
  });
  const set = (key, value) => setValues({ ...values, [key]: Number(value) });
  return (
    <section className="panel studio-admin-panel">
      <div className="panel-header">
        <div>
          <h2>健康检查阈值</h2>
          <p>仅用于提示复核，不自动判定业务方案错误。</p>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>指标</th>
            <th>口径</th>
            <th>黄色 &gt;</th>
            <th>红色 &gt;</th>
            <th>默认</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>集中度差值</td>
            <td>Top N 投资金额占比 − 产出占比</td>
            <td>
              <input
                type="number"
                value={values.concentrationYellow}
                onChange={(event) =>
                  set("concentrationYellow", event.target.value)
                }
              />{" "}
              pp
            </td>
            <td>
              <input
                type="number"
                value={values.concentrationRed}
                onChange={(event) =>
                  set("concentrationRed", event.target.value)
                }
              />{" "}
              pp
            </td>
            <td>5 / 10pp</td>
          </tr>
          <tr>
            <td>经销商超配 / 低配</td>
            <td>经销商投资金额占比 − 产出占比（绝对值）</td>
            <td>
              <input
                type="number"
                value={values.dealerYellow}
                onChange={(event) => set("dealerYellow", event.target.value)}
              />{" "}
              pp
            </td>
            <td>
              <input
                type="number"
                value={values.dealerRed}
                onChange={(event) => set("dealerRed", event.target.value)}
              />{" "}
              pp
            </td>
            <td>3 / 6pp</td>
          </tr>
        </tbody>
      </table>
      <div className="actions studio-admin-save">
        <button
          className="button"
          onClick={() =>
            setValues({
              concentrationYellow: 5,
              concentrationRed: 10,
              dealerYellow: 3,
              dealerRed: 6,
            })
          }
        >
          恢复默认
        </button>
        <button
          className="button primary"
          onClick={() => notify("健康检查阈值尚未接入服务端，本次未保存。", true)}
        >
          保存阈值
        </button>
      </div>
    </section>
  );
}

function AuditPage({ audit }) {
  return (
    <section className="panel studio-admin-panel">
      <div className="studio-table-toolbar">
        <span>共 {audit.length} 条操作记录</span>
        <input type="search" placeholder="搜索操作人 / 对象 / 动作" />
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>操作人</th>
              <th>动作</th>
              <th>对象</th>
              <th>摘要</th>
            </tr>
          </thead>
          <tbody>
            {audit.map((row, index) => (
              <tr key={row.id || index}>
                <td>{time(row.at || row.createdAt)}</td>
                <td>{row.actor || row.user || "—"}</td>
                <td>{row.action || row.type || "—"}</td>
                <td>{row.target || row.scope || row.initiativeId || "—"}</td>
                <td>{row.message || row.summary || "—"}</td>
              </tr>
            ))}
            {!audit.length && (
              <tr>
                <td colSpan="5">
                  <div className="empty">暂无操作审计记录。</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function AdminStudioPage() {
  const context = useWorkbench();
  const {
    page,
    view,
    state,
    identity,
    roles,
    apiMode,
    mutate,
    manageAdminBudget,
    notify,
  } = context;
  if (identity.role !== "admin")
    return <div className="empty">仅系统管理员可访问。</div>;
  const items = view.initiatives || [],
    meta = ADMIN_META[page] || ADMIN_META["admin-versions"];
  const users = useMemo(
    () => (roles || []).filter((user) => user.role),
    [roles],
  );
  return (
    <>
      <PageHead eyebrow={meta[0]} title={meta[1]} description={meta[2]} />
      {page === "admin-versions" && (
        <VersionsPage items={items} notify={notify} />
      )}
      {page === "admin-initiatives" && (
        <InitiativesPage
          items={items}
          identity={identity}
          roles={roles}
          apiMode={apiMode}
          mutate={mutate}
          manageAdminBudget={manageAdminBudget}
          notify={notify}
        />
      )}
      {page === "admin-users" && (
        <UsersPage users={users} identity={identity} notify={notify} />
      )}
      {page === "admin-enums" && <EnumsPage notify={notify} />}
      {page === "admin-thresholds" && <ThresholdsPage notify={notify} />}
      {page === "admin-audit" && <AuditPage audit={state.audit || []} />}
    </>
  );
}
