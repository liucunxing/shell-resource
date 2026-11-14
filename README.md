# 资源投资工作台 V19 工程迭代

本轮基于 `origin/feature_11_11_cx`（`6e70ba5`）与 2026-11-14 最新 V19 原型更新。
支持独立规划版本、Owner 三步拆分与提交冻结、部门齐交确认/撤回/定向退回、管理层已确认组合、
来源版本与 SD/RSM 对比，以及人员归属和历史费用权限配置。实现范围、验证证据与边界见
[V19 工程验收记录](docs/V19_VALIDATION.md)。最新业务、组件标准和数据范围见
[当前需求](docs/CURRENT_REQUIREMENTS.md)；后续改造须重新验证，历史验收不自动覆盖新变更。

计算规则依据供应商开发说明 V2.0 第 3、11–14 章，27 项公式、来源章节及真实数据缺口见 [指标定义](docs/METRIC_DEFINITIONS.md)。该说明基于 V17；最新 V19 的视觉、提交冻结和部门确认流程覆盖其中旧版描述。

> 服务器发布、重启、健康检查、日志和证书续期，请先阅读 [服务器运维手册](docs/SERVER_OPERATIONS.md)。

当前工程提供年度预算分配、其他预算、Excel 回传、草稿保存、提交与部门确认、规划版本、角色范围查询、管理员配置和百炼六点 Insight。同一应用站点提供前端静态文件与 API。

前端采用 React 19、TypeScript 5.9 / JSX、Vite 7、shadcn/ui（Radix）、Tailwind 与 TanStack Table。所有应用控件统一使用共享 shadcn 组件，保留 Shell 品牌色和 V19 流程；新组件遵循 [前端规则](frontend/AGENTS.md)。后端采用 Python 3.11、FastAPI、SQLAlchemy Async、Alembic 和 PostgreSQL。

```text
frontend/   React + shadcn/ui + Vite，默认连接 API；demo 模式独立
backend/    Controller → Service → Repository → DO
docs/       本期业务契约和协作说明
```

正式数据保存在 PostgreSQL `data` schema。整项草稿保存使用事务和修订号；不平衡草稿可保存，提交时必须平衡。管理层只读取部门已确认的提交快照；撤回确认保留 Owner 已提交状态，定向退回后才允许编辑。

## 数据来源与接入限制

当前预算、版本流转、权限、配置和 Insight 记录读写 PostgreSQL；经销商与历史指标实际读取 `data.distributor_sellin_resource_history`。保留 Databricks 配置不代表页面已实时连接 Databricks。

Databricks 只能使用应用 Service Principal 对应且获授权的 schema，当前目标为 `prod.resource_planning.dim_distributor`。2026-11-14 限定该 schema 的个人只读核查可见两个经销商基础视图，各 2,678 行、3 个字段；未看到业务指标与月份/汇率字段。应用 SP 认证仍返回 `401 invalid_client`，个人查询不能证明应用身份可读。其他 schema 的候选数据不能直接接入，不能用个人凭据回退。

历史宽表尚缺真实截止月和合同量；Phasing 的 Vol/合同、Yield 的 C3/完整投资、YoY 的年度公式已定义，不能因缺字段而说成公式未定义。V19 已定义 PPP 的 Vol/C3 目标列，但真实目标来源与字段映射仍缺；合同采用原型已明确的全年签署量。分析产出截零与历史金额保留负数的原型证据见[确认清单](docs/PENDING_DATA_DECISIONS.md)。YTD 配置允许 1–12、默认 10，但与 PG Actual/费用的实际覆盖月份分开表达。金额比较须明确币种、单位、汇率和期间，未知值不补零、不猜月份、不把合同量当 PPP。完整边界见 [指标定义](docs/METRIC_DEFINITIONS.md)。

## 开发与运行

1. 按 [后端说明](backend/README.md) 安装、填写本地配置并核对数据库结构。
2. 在 `frontend` 执行 `npm ci`、`npm run build`。
3. 在 `backend` 启动 Uvicorn，配置 `serve_frontend = true` 后访问 `http://127.0.0.1:8000/`。
4. 通过现有 Portal 邮箱入口或配置的 JWT 入口建立身份。后台逐请求读取 `data.user_permissions` 并校验角色与业务范围。

前后端接口联调只维护 [接口文档](backend/docs/接口文档.md)。前端开发、独立演示模式见 [前端说明](frontend/README.md)。

管理员可从“管理后台 → 人员与权限”模拟查看不同用户的只读视角，操作与验证范围见 [管理员模拟用户视角](docs/ADMIN_USER_PREVIEW.md)。

Portal JWT 独立入口的配置、迁移、联调与回滚见 [Portal 接入说明](deploy/portal-jwt.md)。该能力默认关闭，现有帆软 URL 邮箱入口保留；本轮仅接入资源工具。

V19 本地试用：编译前端后，在 `backend` 使用已安装项目依赖的 Python 执行
`python -m uvicorn tests.v19_prototype_fixture:app --app-dir src --host 127.0.0.1 --port 8019`，
访问 `http://127.0.0.1:8019/`。
独立 SQLite 仅保存合成数据；其他角色入口和验证证据见 [V19 工程验收记录](docs/V19_VALIDATION.md)。

## 本地密钥

在已被 Git 忽略的 `backend/config/settings.toml` 的 `[development]` 段填写 `ai_api_key`、`ai_base_url`、`ai_model`，默认模型 `qwen-plus`。Base URL 使用百炼控制台给出的兼容地址。数据库连接和存储密钥也仅保存在该文件；修改后重启后端。不要把密钥放进前端 `VITE_*` 配置。

## 交付边界

开发邮箱入口使用 `X-User-Email`，`production` 环境明确拒绝此方式；Portal JWT / Cookie 走独立认证路由，真实部署登录仍需验收。Tracking、外部审批系统和实时协同未纳入当前已验证能力；V19 部门确认/退回已实现，小 One 真实问数与下游授权需单独联调。

2026-11-14 19:50（+08:00）已将远端 PostgreSQL `resource_dev` 升级到 `20261114_03`，
原有业务值核对一致；31 项 PG 隔离验收及四角色真实库只读接口检查通过。
20 个历史用户的所属 Sector/Department 需按真实归属配置，未配置时不展示费用明细。
应用服务器尚未部署，真实 SSO、AI 调用和业务 UAT 尚待验证。
迁移演练、执行方式与证据见 [V19 工程验收记录](docs/V19_VALIDATION.md)。

## 本轮界面验收

shadcn 统一调整需运行 `npm test`、`npm run build`、`npm run check:bundle`，并验证桌面/窄屏、键盘焦点、弹窗和主要业务流程。调整完成后提供页面与验证结果，请用户确认效果；[V19 工程验收记录](docs/V19_VALIDATION.md) 中此前测试数量仅作为历史基线。

用户已要求本轮测试完成后推送两个分支；检查通过后执行推送。代码推送、服务器部署、视觉确认和真实业务 UAT 是不同状态，分别提供证据。

## Docker 单机部署

`Dockerfile` 会先构建前端，再把静态文件与 FastAPI 后端放入同一个非 root 运行容器；`compose.yaml` 负责配置、健康检查、端口和自动重启。服务器部署、数据库初始化、升级、验收与回滚步骤见 [Docker 部署手册](docs/DOCKER_DEPLOYMENT.md)。

首次执行 `sudo bash deploy/deploy.sh --init` 并填写 `deploy/settings.toml`，之后执行 `sudo bash deploy/deploy.sh --port 18080` 一键构建和启动。脚本实时输出 8 个阶段，失败立即停止；完整日志保存在 `logs/deploy/`。本项目仅监听服务器本机地址，公网 HTTPS 由共享网关处理。

同一台服务器的多个平台通过 [共享 HTTPS 网关操作手册](docs/SHARED_GATEWAY.md) 接入；网关独占 80/443，证书保留在服务器 `/opt/digitalshell-gateway/certs/`，不进入 Git 或镜像。

本轮组件统一结果与验证边界见 [shadcn 验收记录](docs/SHADCN_VALIDATION.md)；此前视觉效果已被用户否定，正在按最新 V19 原型还原；功能测试不等于视觉保真通过。

## 本地直接验收

使用 `backend/tests/v19_prototype_fixture.py` 启动最新 V19 原型数据预览，无需登录或帆软跳转，直接打开 `http://127.0.0.1:8019/`。顶部切换原型中的 Owner、部门负责人、管理层和管理员，账号使用本地合成身份；刷新保留本次浏览器会话所选角色。

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn tests.v19_prototype_fixture:app --app-dir src --host 127.0.0.1 --port 8019
```

先在 frontend 执行 `npm run build`。该入口仅由本地 fixture 注入配置、读写 `.cache/v19-prototype` 的 SQLite 数据。数据来自 `backend/tests/fixtures/v19_prototype_demo.json` 的最新原型导出，不使用旧 V1.2 demo JSON。旧简化测试库 `.cache/v19-final` 保留，正式入口与 Portal 会话验证不变。

用户已明确：本地可以导入原型演示数据；远端 PG 连接真实业务数据。演示数据、模拟月份和账号不能写入远端 PG，也不能作为真实数据验收证据。远端核查结果见 [PG 历史数据评估](docs/PG_SELLIN_ASSESSMENT.md)。

原型导出由 `backend/scripts/export_v19_prototype.cjs` 在全新浏览器上下文执行最终 `enterDemo()` 生成，记录源 SHA、明确的演示月份及单位。包含120家虚构经销商、10个虚构用户及两个规划版本，源JSON两版本均无部门确认。本地fixture另标注 `derivedLocalPreparation`，通过正常业务服务确认202612的齐交部门供管理层查看基线；202701保留原22提交、0确认。派生测试准备不反写源JSON或远端PG。重复提取仅运行时审计时间变化；原始HTML保持不变。

本地原型与远端真实数据分支的启动、测试和最新结果见 [双分支测试说明](docs/TEST_BRANCHES.md)。

当前需要业务/数据负责人补齐的事项见 [剩余数据与口径确认清单](docs/PENDING_DATA_DECISIONS.md)。
