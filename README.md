# 资源投资工作台 V20

2026-11-16 当前范围确认：旧右侧抽屉的历史参考、Insight、嵌入 Data Agent 不属于本版，直接清理其前后端模块、专属测试及构建引用。保留组合页/编辑页历史指标、经销商数据和正常详情下钻；Portal 登录与认证代码暂不使用但保留。保留数据库历史表和既有迁移，不执行数据删除。本轮集中推送，不部署。

2026-11-15，用户已确认V20原型并授权同步工程、更新规则、测试后推送。当前以[V20同步说明](docs/V20_IMPLEMENTATION.md)和[当前需求](docs/CURRENT_REQUIREMENTS.md)为准；旧V19验收记录保留为历史证据。

V20包含SD/RSM切换和四组组织对照、V17经销商分配明细表头、按所属部门限制历史费用、完整详情抽屉，以及第一步“已核对本版预留”后才可继续的流程。PPP误加字段已取消；Phasing直接读取PG已计算的phasing_2025/phasing_2026。

全局表格已统一表头冻结、名称/标识列靠左、数值列居中与等宽数字、真实数值排序；经销商明细每页支持10/20/50/全部。验证范围与证据见[全局表格验收](docs/GLOBAL_TABLES_VALIDATION.md)。

全局切换统一使用紧凑中性灰 shadcn Tabs；2026 YTD 的截止月说明移至 ! 悬浮提示。变更与本地检查见[切换组件验证](docs/TABS_REFRESH_VALIDATION.md)。

缩放适配：顶部导航随可用宽度换行，弹窗标题/底部操作保留、长内容独立滚动，抽屉限制长标题高度。1920×1080、150%缩放对应逻辑空间及低高度场景的检查范围见[弹窗与抽屉验证](docs/VIEWPORT_COMPATIBILITY.md)。

管理层集中度抽屉按 V20 展示四维投资构成，明细标题随维度切换；已移除额外的固定 Initiative 来源表，经销商下钻仍可查看项目来源。见[集中度核查与验证](docs/EXECUTIVE_CONCENTRATION_FOLLOWUP.md)。

> 服务器发布、重启、健康检查、日志和证书续期，请先阅读 [服务器运维手册](docs/SERVER_OPERATIONS.md)。

当前工程提供年度预算分配、其他预算、Excel 回传、草稿保存、提交与部门确认、规划版本、角色范围查询、管理员配置。同一应用站点提供前端静态文件与 API。

前端采用 React 19、TypeScript 5.9 / JSX、Vite 7、shadcn/ui（Radix）、Tailwind 与 TanStack Table。所有应用控件统一使用共享 shadcn 组件，保留 V20 原型风格和流程；新组件遵循 [前端规则](frontend/AGENTS.md)。后端采用 Python 3.11、FastAPI、SQLAlchemy Async、Alembic 和 PostgreSQL。

```text
frontend/   React + shadcn/ui + Vite，默认连接 API；demo 模式独立
backend/    Controller → Service → Repository → DO
docs/       本期业务契约和协作说明
```

正式数据保存在 PostgreSQL `data` schema。整项草稿保存使用事务和修订号；不平衡草稿可保存，提交时必须平衡。版本开放且未截止时，Owner 在部门确认前可反复编辑重提；首次、继承上版、重复及批量提交均无需变更原因，调整依据说明选填。管理层只读取部门已确认的提交快照；撤回部门提交直接恢复本部门 Owner 编辑并保留现有提交；管理员驳回全版本并设置新的未来截止时间。

2026-11-17 草稿恢复：各 Initiative 独立保留当前步骤及预算与预留核对勾选，切换项目继续原步骤和分配草稿；第一、二步点击“下一步”时自动覆盖保存，成功后进入下一步；失败保留当前步骤和编辑。只有第三步显示“保存草稿”和“提交”。自动或手动保存后，刷新或重新登录也可恢复。核对指纹按预算、预留金额／原因／说明及项目、Owner、版本绑定，不受预留行数据库 ID 或排序变化影响；实际内容变化需重新核对，已在本版提交过的项目仍沿用免重复核对规则。新版本不继承旧版编辑步骤和勾选。

草稿 API 的可选 `editorState` 为 `{step: 1|2|3, reserveAcknowledgement: string}`，随草稿修订一起保存；旧调用省略字段时保留原值，显式 `null` 清除。部署本次代码前需执行 Alembic `20261117_01`（新增可空 `data.budgets.editor_state` JSON 列）；本轮只推送代码，不部署或执行远端数据库升级。

## 数据来源与接入限制

当前预算、版本流转、权限、配置读写 PostgreSQL；经销商与历史指标实际读取 `data.distributor_sellin_resource_history`。保留 Databricks 配置不代表页面已实时连接 Databricks。

Databricks 只能使用应用 Service Principal 对应且获授权的 schema，当前目标为 `prod.resource_planning.dim_distributor`。2026-11-14 限定该 schema 的个人只读核查可见两个经销商基础视图，各 2,678 行、3 个字段；未看到业务指标与月份/汇率字段。应用 SP 认证仍返回 `401 invalid_client`，个人查询不能证明应用身份可读。其他 schema 的候选数据不能直接接入，不能用个人凭据回退。

最新PG核查：1,489个Sector＋经销商，无重复；2025/2026四类费用及Actual均无NULL。用户已确认本批销量、C3、费用均至2026年9月，期间字段后续补，下一次预计2027年1月更新；经销商target已接入：单位L，2025全年、2026年1–9月；2026-11-16新核查源Phasing非空535/695条，源值直读、零与缺失保持原样。详见[接入及对账](docs/DEALER_TARGET_INTEGRATION.md)。B2B两类费用源0需核实，20个真实账号所属组织待配置。详见[当前缺项与例子](docs/PENDING_DATA_DECISIONS.md)和[本次PG评估](docs/PG_SELLIN_ASSESSMENT.md)，不要再引用旧“2026费用全空”的结论。

历史C3和当前费用源均为USD，费用÷管理员汇率归一为USD，暂保持1；规划金额为CNY。负费用正常参加净额，Yield无x/倍、负值或无效显示“—”。历史费用权限按所属部门大类上限裁剪，用户/部门配置只能收窄，管理员和管理层不自动越权。

## 开发与运行

1. 按 [后端说明](backend/README.md) 安装、填写本地配置并核对数据库结构。
2. 在 `frontend` 执行 `npm ci`、`npm run build`。
3. 在 `backend` 启动 Uvicorn，配置 `serve_frontend = true` 后访问 `http://127.0.0.1:8000/`。
4. 通过现有 Portal 邮箱入口或配置的 JWT 入口建立身份。后台逐请求读取 `data.user_permissions` 并校验角色与业务范围。

前后端接口联调只维护 [接口文档](backend/docs/接口文档.md)。前端开发、独立演示模式见 [前端说明](frontend/README.md)。

管理员可从“管理后台 → 人员与权限”模拟查看不同用户的只读视角，操作与验证范围见 [管理员模拟用户视角](docs/ADMIN_USER_PREVIEW.md)。

Portal JWT 独立入口的配置、迁移、联调与回滚见 [Portal 接入说明](deploy/portal-jwt.md)。该能力默认关闭，现有帆软 URL 邮箱入口保留；本轮仅接入资源工具。

V20 本地试用：编译前端后，在 `backend` 使用已安装项目依赖的 Python 执行
`python -m uvicorn tests.v20_prototype_fixture:app --app-dir src --host 127.0.0.1 --port 8019`，
访问 `http://127.0.0.1:8019/`。
独立 SQLite 仅保存合成数据；其他角色入口和验证证据见 [V19 工程验收记录](docs/V19_VALIDATION.md)。

## 本地密钥

数据库连接、存储及保留的 Portal 登录密钥仅保存在被 Git 忽略的 `backend/config/settings.toml` 或环境变量中，不放入前端 `VITE_*` 配置。本版不调用模型或嵌入 Data Agent；旧 AI/Data Agent 配置键仅兼容已有配置文件，不启用功能。

## 交付边界

开发邮箱入口使用 `X-User-Email`，`production` 环境明确拒绝此方式；Portal JWT / Cookie 走独立认证路由，真实部署登录仍需验收。Tracking、外部审批系统和实时协同未纳入当前已验证能力；部门确认/撤回和管理员全版本驳回已实现，旧右侧历史参考、Insight 和嵌入 Data Agent 已按当前 V20 范围清理。

2026-11-14 19:50（+08:00）已将远端 PostgreSQL `resource_dev` 升级到 `20261114_03`，
原有业务值核对一致；31 项 PG 隔离验收及四角色真实库只读接口检查通过。
20 个历史用户的所属 Sector/Department 需按真实归属配置，未配置时不展示费用明细。
应用服务器尚未部署，真实 SSO 和业务 UAT 尚待验证。
迁移演练、执行方式与证据见 [V19 工程验收记录](docs/V19_VALIDATION.md)。

## 本轮界面验收

shadcn 统一调整需运行 `npm test`、`npm run build`、`npm run check:bundle`，并验证桌面/窄屏、键盘焦点、弹窗和主要业务流程。调整完成后提供页面与验证结果，请用户确认效果；[V19 工程验收记录](docs/V19_VALIDATION.md) 中此前测试数量仅作为历史基线。

用户已要求本轮测试完成后推送两个分支；检查通过后执行推送。代码推送、服务器部署、视觉确认和真实业务 UAT 是不同状态，分别提供证据。

## Docker 单机部署

`Dockerfile` 会先构建前端，再把静态文件与 FastAPI 后端放入同一个非 root 运行容器；`compose.yaml` 负责配置、健康检查、端口和自动重启。服务器部署、数据库初始化、升级、验收与回滚步骤见 [Docker 部署手册](docs/DOCKER_DEPLOYMENT.md)。

首次执行 `sudo bash deploy/deploy.sh --init` 并填写 `deploy/settings.toml`，之后执行 `sudo bash deploy/deploy.sh --port 18080` 一键构建和启动。脚本实时输出 8 个阶段，失败立即停止；完整日志保存在 `logs/deploy/`。本项目仅监听服务器本机地址，公网 HTTPS 由共享网关处理。

同一台服务器的多个平台通过 [共享 HTTPS 网关操作手册](docs/SHARED_GATEWAY.md) 接入；网关独占 80/443，证书保留在服务器 `/opt/digitalshell-gateway/certs/`，不进入 Git 或镜像。

本轮组件统一结果与验证边界见 [shadcn 验收记录](docs/SHADCN_VALIDATION.md)；该记录为此前V19历史证据；本轮V20结果见[V20同步说明](docs/V20_IMPLEMENTATION.md)。

## 本地直接验收

使用 `backend/tests/v20_prototype_fixture.py` 启动V20 独立原型数据预览，无需登录或帆软跳转，直接打开 `http://127.0.0.1:8019/`。顶部切换原型中的 Owner、部门负责人、管理层和管理员，账号使用本地合成身份；刷新保留本次浏览器会话所选角色。

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn tests.v20_prototype_fixture:app --app-dir src --host 127.0.0.1 --port 8019
```

先在 frontend 执行 `npm run build`。该入口仅由本地 fixture 注入配置、读写 `.cache/v20-prototype` 的 SQLite 数据。数据来自 `backend/tests/fixtures/v19_prototype_demo.json` 的最新原型导出，不使用旧 V1.2 demo JSON。旧简化测试库 `.cache/v19-final` 保留，正式入口与 Portal 会话验证不变。

用户已明确：本地可以导入原型演示数据；远端 PG 连接真实业务数据。演示数据、模拟月份和账号不能写入远端 PG，也不能作为真实数据验收证据。远端核查结果见 [PG 历史数据评估](docs/PG_SELLIN_ASSESSMENT.md)。

原型导出由 `backend/scripts/export_v19_prototype.cjs` 在全新浏览器上下文执行最终 `enterDemo()` 生成，记录源 SHA、明确的演示月份及单位。包含120家虚构经销商、10个虚构用户及两个规划版本，源JSON两版本均无部门确认。本地fixture另标注 `derivedLocalPreparation`，通过正常业务服务确认202612的齐交部门供管理层查看基线；202701保留原22提交、0确认。派生测试准备不反写源JSON或远端PG。重复提取仅运行时审计时间变化；原始HTML保持不变。

本地原型与远端真实数据分支的启动、测试和最新结果见 [双分支测试说明](docs/TEST_BRANCHES.md)。

当前需要业务/数据负责人补齐的事项见 [剩余数据与口径确认清单](docs/PENDING_DATA_DECISIONS.md)。

已确认指标的本轮工程修复与测试见 [指标实现验证](docs/METRIC_IMPLEMENTATION_VALIDATION.md)；需要补的数据和业务选择见 [待确认清单](docs/PENDING_DATA_DECISIONS.md)。

2026-11-15最新币种/Yield及跨Sector规则落实见[验证记录](docs/YIELD_CURRENCY_VALIDATION.md)。


## 历史投资汇率（2026-11-15最新确认）

管理员组织与枚举页配置 `historyInvestmentExchangeRate`（有限正数、默认1），保存沿用revision与审计。历史源费用除以该参数得到USD，负费用正常参与有符号净额；C3已是USD不重复转换，规划预算/分配保持CNY。此参数统一作用于全部历史年份，不是日期化汇率。Yield在正C3/完整正净投资下计算，无x/倍后缀，无效显示“—”。历史USD与规划CNY未有规划汇率时不计算差额或倍数。应用SP仍为401 invalid_client；用户随后授权跨库只读探源，已找到按月币种对汇率表，详见[探源结果](docs/DATABRICKS_FX_DISCOVERY.md)。详见[汇率与界面说明](docs/UI_FX_FOLLOWUP.md)。

V20本地fixture保留V19合成业务金额/名单，使用V20部门费用默认；旧角色推导的空费用列表不会冒充用户显式拒绝。缓存与旧V19分开，manifest记录适配边界。兼容文件名`v19_prototype_demo.json`不代表界面仍为V19；真实PG不加载该数据。


2026-11-15 界面密度调整：试算对比文字放大并收窄弹窗；详情抽屉默认70%视口、手机全宽；组合子Tab冻结；叠加表Initiative采用同色系紧凑可下钻标签并平衡列宽；历史表现采用横向指标网格；单位统一K$/KL。金额计算及数据隔离保持原口径。

2026-11-15 字体补充：全局优先微软雅黑（Microsoft YaHei），包括弹窗、抽屉与表单；Initiative、经销商、资源大类等可点击业务名称统一700加粗，保留原字号与交互。

### V20 头像个人信息（2026-11-15）

右上角头像/姓名可打开“我的用户信息”，显示当前身份、用户ID、所属部门、授权范围和启用管理员联系方式。支持键盘、关闭后焦点恢复与窄屏单列；模拟查看显示被模拟用户的信息。实现和验证见 [V20同步说明](docs/V20_IMPLEMENTATION.md#头像个人信息补齐2026-11-15)。

### 管理员模板与颜色配置

用户与权限、项目配置页支持Excel模板下载与预览导入；组织与枚举页配置Initiative/资源大类/部门颜色。项目保存错误会定位到缺失字段，负责项目按两列标签展示。[实现与验证](docs/ADMIN_CONFIGURATION_VALIDATION.md)。

本机main连接PG测试可直接打开 `http://127.0.0.1:8020/`，不需帆软；顶部切换真实库已有启用账号。显式loopback入口及限制见[测试入口](docs/TEST_BRANCHES.md)。

2026-11-16 最新确认：Owner 部门提交前可反复修改重提；部门提交管理层后锁定。部门只能在版本开放且未截止时提交或撤回；撤回直接解除本部门全部 Owner 锁，保留现有提交，保存修改后须重新提交。2026-11-17修订：管理员可随时停用版本，无需部门提交齐全；发布、重新发布或管理员驳回并开放一个版本时，其他开放版本原子停用，全部年份最多一个版本开放提交。停用保留分配、提交及部门确认记录；截止只停止业务操作，不等于停用。管理员驳回为全版本一键释放全部部门，必须填写原因和晚于当前时间的新截止时间，原子重开版本并撤销所有部门确认，已有 Owner 提交和历史快照保留，未提交/已修改草稿不能伪造为已提交。取消部门退回 Owner、单项目和单 Owner 退回流程。此次测试后推送，不部署。 本轮不新增数据库结构迁移，沿用版本管理的 `20261116_02`。

2026-11-16 权限配置入口简化：移除组织配置页重复的“按用户收窄权限”表格；保留部门历史费用默认权限，个人例外统一在“用户管理 → 编辑用户 → 历史费用列范围”维护。既有个人限制及后端权限裁剪规则不变。

2026-11-16 性能优化：工作台初始化改为按授权项目批量查询，保存目录只读身份字段，大响应协商gzip；用户保存合并重复列表刷新。测量、边界及回归说明见 [性能排查](docs/PERFORMANCE_20261116.md)。

2026-11-16 写入与状态加载性能：版本复制改为批量读写，部门状态合并查询，人员列表移除全局配置读锁；已保存未修改的方案跳过重复保存，非当前版本操作仅刷新版本清单。真实 PG 隔离数据对比与验证边界见 [提交与版本性能](docs/MUTATION_PERFORMANCE_20261116.md)。

2026-11-16 Target/Yield与全局空值排查：[修复及核验记录](docs/HISTORY_AVAILABILITY_20261116.md)。源值直读、历史确认按相关字段校验，保留真实NULL、费用权限及无基期规则。


2026-11-16 加权 Phasing 补充：用户确认按有效完整数据计算，多经销商仅纳入同年源 target>0 且源 Phasing 有限的记录，以 target 加权；缺失与非正权重跳过，零 Phasing 有效，无有效记录显示“—”。单家明细仍直接显示源 Phasing。提示明确结果仅代表有效数据范围。旧部门退回遗留状态已按用户要求全局核查清理，保留历史提交和审计；不自动确认部门。


2026-11-16 重复编辑体验：当前版本已有提交记录（workflow.publicationId）的 Initiative 不再要求重复勾选预算与预留核对；重新进入默认打开第三步，第二步也可直接访问。保存草稿、刷新、部门撤回或管理员重开后仍沿用本版提交记录；仅从来源版本复制、不含本版提交的项目仍须首次核对。编辑权限、版本截止、部门锁定、预算平衡与预留用途校验不变；Owner 变更原因按2026-11-17确认改为选填。草稿与提交页使用同一判断。

2026-11-17 占比对照图：投资、Vol、C3 三条柱均显示实际百分比，零为0.0%、缺失为—；全表共用覆盖三类最大占比的刻度（向上取整至10%），不再截断超出历史刻度的投资柱。本轮不部署，随其他修改一起部署。

2026-11-17 快捷方案支持再次点击取消并恢复首次试算前的分配，切换方案不覆盖恢复起点；新增确认后清空经销商金额的图标。移除编辑页复制来源方案、撤销上一步和提交历史三个操作入口；服务端历史记录保留。


2026-11-17 版本编辑补充：修改版本名称、截止时间不改变发布/开放状态，不修改已有分配和提交确认；已开放版本延后或清空截止时间后恢复允许操作，但显式停用及部门确认锁不被绕过。项目配置与批量导入也保留版本原发布/开放状态，不再使整个版本退回未发布；涉及预算/归属等配置变化仍按原规则标记受影响项目须重提并撤销相关部门确认。停用及切换开放版本由管理员显式操作。
