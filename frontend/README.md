# 资源投资工作台前端 V19

React 19、TypeScript 5.9 / JSX、Vite 7、shadcn/ui（Radix）、Tailwind 和 TanStack Table。应用控件统一使用 `src/components/ui/`，通过主题 token 保留 Shell 品牌色。组件与协作约定见 [AGENTS.md](AGENTS.md)，业务和数据边界见 [当前需求](../docs/CURRENT_REQUIREMENTS.md)。

默认通过后端工作台 API 读取和写入；仅显式设置 `VITE_DATA_MODE=demo` 时使用前端旧演示数据。本地 V19 原型验收通过专用后端 fixture 的 SQLite API 运行，不能与旧前端 demo 模式混同。API 失败不会回退到 demo。归档 HTML 原型保留供比对，可导出到本地验收库，不嵌入应用、不作为生产数据来源。

## 运行与检查

Node 版本沿用仓库 `.nvmrc` 与 Dockerfile 的已锁定环境；依赖使用 lockfile。以下命令在 `frontend` 运行：

```powershell
npm ci
npm run dev
```

开发入口 `http://127.0.0.1:5175`，端口冲突直接失败，API 代理到后端 `http://127.0.0.1:8000`。复制 `.env.example` 为忽略的 `.env.local` 后按实际场景配置；`VITE_*` 均为公开浏览器配置，不能放凭据。生产身份不能依赖手工邮箱。

```powershell
npm test
npm run build
npm run check:bundle
npm run preview
```

`build` 包含 TypeScript 检查；现有 JSX / JS 开启 `allowJs`，不代表完整静态类型检查。项目没有独立 lint script。预览固定为 `http://127.0.0.1:5175`；仅提供构建静态页面，端到端 API 验收优先使用后端同站点服务。

编译前端后，隔离合成验收入口在后端启动：

```powershell
cd ../backend
.\.venv\Scripts\python.exe -m uvicorn tests.v19_prototype_fixture:app --app-dir src --host 127.0.0.1 --port 8019
```

访问 `http://127.0.0.1:8019/`。其他合成角色及历史证据见 [V19 验收记录](../docs/V19_VALIDATION.md)。此服务只访问隔离 SQLite，不连接开发 PG/AI，不代表真实 SSO 或部署验收。

## 页面与业务规则

| 角色 / 页面 | 当前行为 |
|---|---|
| Owner / 我的工作台 | 本人 Initiative、预算与版本状态；三步拆分、保存草稿、正式提交冻结 |
| Initiative 编辑 | 经销商选择与分配、历史参考、其他预算、Excel、找平；保存可不平衡，提交必须平衡；被退回后重新编辑 |
| 部门负责人 | 全部 Initiative 提交后确认；撤回取消部门确认但保留 Owner 提交；按项目/Owner/全部门带原因退回 |
| 管理层 | 只计入已确认分配与快照，预算仍可见；来源版本与 SD/RSM 对比保留退出组织 |
| 管理后台 | 预算、Owner、规划版本发布/关闭、用户业务范围与独立所属组织、历史费用权限、配置与审计 |
| 原始数据 / 数据口径 | 展示授权范围及来源；缺失字段/月份明确标注，不补造 PPP、合同量或最新月份 |
| 右侧工作栏 | 历史参考、反馈、Insight、小 One 入口；功能可用性按身份和配置判定 |

新版本只复制最后提交快照，不能继承未提交修改。用户所属 Sector/Department 不等于业务权限范围；费用明细受独立权限控制，缺归属不展示。当前运行历史源为 PG `data.distributor_sellin_resource_history`，并非实时查询 Databricks。

计算定义来自供应商 V2.0 第3、11–14章，完整映射见 [指标定义](../docs/METRIC_DEFINITIONS.md)；V2.0旧V17截图和提交流程由最新V19覆盖。Vol/合同显示KL、C3/历史费用显示K$。历史助手统一处理 Phasing（合同>0）、Yield（C3和完整投资均>0）、YoY（基期≤0为“无基期”），聚合先求和再除；试算负权归0，总权0不能采用。已有公式的实现差异由工程修复，不能写成待业务定义。

管理端 `ytdCutoffMonth` 接受1–12、默认10，用于配置期间标签；来源Actual/费用实际截至月份单独展示，未知时仍标未提供。切换标签不重算或伪造PG快照。本地原型显式10月快照仅供SQLite演示，不覆盖真实PG数据。

## shadcn 组件标准

- 基础控件、表格、卡片、状态、Tabs、Dialog 统一从共享组件导入；业务页面组合这些组件，不维护第二套基础控件。
- 主题使用语义 token，操作使用标准 variant；保留焦点、键盘、禁用和错误状态，图标按钮必须有可访问名称。
- 简单选择使用 `NativeSelect` 保留表单事件；表格在容器内横向滚动，不能撑破窄屏。布局与领域图形可保留专用 CSS。
- 共享控件样式集中维护，不依赖旧页面类覆盖颜色、边框和焦点。不要重新引入 Ant Design 或 Fluent UI。
- 较大组件/交互取舍可请用户确认；本轮调整完提供实际页面和验证结果，请用户确认效果。

## Excel 与包体

Owner 和管理员使用页面下载的 `.xlsx` 模板。导入后先预览校验与差异，确认才写入；取消不写入，有错误不能确认，过期预览需重新导入。Owner 模板限定当前 Initiative，管理员模板不能覆盖经销商分配和提交快照。

Excel 解析与生成均在按需模块 Worker 内执行，ExcelJS 不进入 UI 主线程依赖图。`npm run check:bundle` 在构建后检查 UI 分包不超过 500 KB、ExcelJS 仅一份且只供 Worker 使用。不能提高阈值绕过检查；下载前保留 Portal 会话与模拟身份校验。

## 小 One 与外部数据

`VITE_YIWEN_IFRAME_URL` 只接受公开产品 URL，不允许放 token/密码。当前 `.env.example` 给出问数服务地址，真实服务登录、Cookie、CSP 和权限仍需联调；iframe load 不等于登录成功。未配置时的本地场景演示须明确标注。

桌面工作栏保持主工作区可见，窄屏可使用抽屉并支持 Escape、焦点恢复。首次打开 iframe 后保留实例，切换身份或刷新时按现有逻辑重建。资源工具不据此声称问数服务的数据来自哪个库。

Databricks 仅允许应用 Service Principal 在被授权 schema 中访问，当前为 `prod.resource_planning`。浏览器不直接连接，个人可读其他 schema 不构成应用授权，认证失败不能回退个人账号。当前数据缺口见 [当前需求](../docs/CURRENT_REQUIREMENTS.md)。

## Portal 入口

### Portal JWT 独立入口（2026-11-02）

`/portal-embed/bootstrap/{instanceId}` 在后端验签并建立会话后加载，前端确认受保护的
context 与 session，使用仓库随附的 `@oneportal/embed-browser-sdk/child` 发送 READY，
再进入 `/portal-embed/workbench#portal-instance={instanceId}`。Hash 只保存非凭据的
实例 ID，刷新/新标签页仍必须通过当前 Cookie 的 context/session 校验。

新入口强制使用真实 API 模式（不受 `VITE_DATA_MODE=demo` 影响），请求固定走
`/portal-embed/api/v1/workbench`，附带 `X-Portal-Instance`；写请求和退出另附
内存中的 `X-Portal-CSRF`。不读取、修改或清空旧 `shell-resource-dev-email`，
不接受 URL 邮箱或 `X-User-Email` 作为新身份。验证失败只提示从 Portal 重新进入。
原帆软 URL/旧 API/手工测试邮箱入口保持原行为。

Portal 入口在返回标签页、每 30 秒和生成 CSV/XLSX 下载前校验会话；后端拒绝
过期、换账号或权限变化时卸载工作台。已下载或已读取到客户端的数据不能被撤回。
退出只调用新入口的退出接口，不修改帆软缓存。关闭 iframe 不等于下游会话注销。
本轮 Portal 页面不显示问数入口，原帆软入口的 Data Agent 行为保留。

SDK 源码以 `vendor/embed-browser-sdk` 私有 file dependency 随工程构建，来源见其
`PROVENANCE.md`。正常 `npm ci` / `npm run build` 不依赖旁边的 Portal 仓库。
本机 HTTP 联调时显式设置 `VITE_PORTAL_ALLOW_LOOPBACK_HTTP=true`；部署 HTTPS
保留默认 false。Vite 仅将 `/portal-embed/login`、`/portal-embed/api` 和
`/portal-embed/logout` 转发至 8000 端口，页面由 Vite 提供；部署由后端提供已构建页面。
Cookie/CSP 与真实用户权限仍需真实部署浏览器验收。


## 目录与验证范围

- `src/components/ui/`、`components.json`：共享 shadcn 组件及生成约定。
- `src/workbench/pages/`：业务页面，按需加载。
- `src/workbench/WorkbenchContext.jsx`、`api.js`：状态和请求；Portal 入口使用其独立会话请求封装。
- `src/workbench/domain/`：领域计算、演示夹具与 Excel 适配。
- `src/workbench/file-import.worker.js`：Excel Worker。
- `prototypes/`：原型归档，随构建复制但不作为应用运行页面。

历史 V19 的 289 项前端测试与浏览器结果记录在 [验收记录](../docs/V19_VALIDATION.md)。shadcn 改造后须重新运行检查并验证桌面/窄屏、输入、选择、弹窗取消和提交流程；历史通过不代表本次 UI 已验收。

本轮组件统一结果与验证边界见 [shadcn 验收记录](../docs/SHADCN_VALIDATION.md)；此前视觉效果已被用户否定，正在按最新 V19 原型还原；功能测试不等于视觉保真通过。
