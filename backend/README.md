# 资源投资工作台后端 V19

FastAPI + SQLAlchemy Async + PostgreSQL。沿用 `Controller → Service → Repository → DO`：请求校验在 DTO，业务规则和事务在 Service，明确的数据查询在 Repository。无权限缓存、Agent 框架或向量库。

## 安装与配置

在 `backend` 目录执行（项目目标 Python 3.11）：

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --index-url https://pypi.org/simple pip==26.2.2
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
# 仅在本地配置尚不存在时复制，避免覆盖已有密钥
if (!(Test-Path config/settings.toml)) {
    Copy-Item config/settings.example.toml config/settings.toml
}
```

`backend/.env` 仅保存 `APP_ENV=development`，可提交。真实 `config/settings.toml` 被 Git 忽略，配置分为 `[development]`、`[test]`、`[production]`。进程环境变量 `APP_ENV` 可以覆盖环境选择，`APP_SETTINGS_FILE` 可指定配置文件。改动配置后重启应用。

`requirements.txt` 自动引用 `constraints.txt`，将运行依赖固定为 2026-10-23 核验的线上版本，并为 certifi / aiohttp 设置安全版本下限。更新约束时需重新运行后端测试、依赖审计和镜像预检；该文件是版本约束，不是带制品哈希的锁文件。开发工具仍按 `requirements-dev.txt` 管理。安装源必须使用 HTTPS 并保留证书校验；需要镜像时可使用 `--index-url https://mirrors.aliyun.com/pypi/simple/`。

生产容器继续使用 Python 3.11；已有 Windows Python 3.13 开发环境应使用 3.13.17 或之后的安全补丁版本，并验证虚拟环境实际加载的解释器和 OpenSSL。pip 需使用 26.2.2，确保其内嵌 certifi 也已更新；仅更新项目独立 certifi 包不会更新 pip 内嵌证书库。

编辑 `[development]`：

```toml
database_url = "postgresql+asyncpg://USER:URL_ENCODED_PASSWORD@HOST:5432/resource_dev?ssl=require"
db_echo = true
serve_frontend = true
ai_api_key = ""
ai_base_url = ""
ai_model = "qwen-plus"
ai_timeout_seconds = 60
```

填写真实数据库连接，密码中的特殊字符必须 URL 编码。开发环境的 `db_echo = true` 会在后端控制台输出经过 SQLAlchemy 引擎执行的 SELECT、INSERT、UPDATE、DELETE、事务操作及绑定参数；改为 `false` 可关闭。生产配置默认关闭，生产环境即使手动开启也会隐藏绑定参数。百炼 key 仅填在本地 `ai_api_key`；Base URL 复制控制台的兼容地址，按地域填写业务空间，参见[百炼官方接入文档](https://help.aliyun.com/zh/model-studio/first-api-call-to-qwen)。后端只发送已授权范围内的证据，单次生成六点解释；缺配置、超时或不合规模型响应会保留旧分析，草稿和提交不依赖 AI。

## 数据来源与权限范围

当前预算、分配、规划版本/部门流转、用户权限、配置和 Insight 记录存储在 PostgreSQL `data` schema。经销商名单和历史读取 `data.distributor_sellin_resource_history`，并非页面实时读取 Databricks；保留的 Databricks Repository 与配置不是运行调用证据。旧参考导入写 `workspace_references`，不会更新这张历史宽表。

Databricks 仅允许应用 Service Principal 访问被分配且授权的 schema，当前配置目标是 `prod.resource_planning.dim_distributor`。不得使用个人 CLI/token 回退，也不能直接接入其他 schema。2026-11-14 个人只读核查在该范围可见两个基础视图，各 2,678 行、3 个字段；应用 SP 认证仍为 `401 invalid_client`，因此尚未证明应用身份能读取。业务指标、合同量、PPP、业务月份与汇率需先由数据负责人提供到授权范围，再用应用身份验证。

历史缺失不能按零处理或补造截止月；Actual 与费用分别记录真实业务月份，币种/单位/汇率及期间一致后才能比较。详细要求见 [当前需求](../docs/CURRENT_REQUIREMENTS.md) 和 [后端规则](AGENTS.md)。

指标公式、源章节与缺口见 [V2.0 指标定义](../docs/METRIC_DEFINITIONS.md)。Phasing 要求合同>0；Yield 要求 C3 和完整历史投资都>0；YoY 按年度值重算，基期≤0返回无基期。PG 原值保留用于对账；派生比率的应用值不能伪装为源字段。

管理配置 `ytdCutoffMonth` 为1–12整数、默认10，作为工作台显示设置；Actual/费用真实覆盖月份仍由独立来源元数据声明。修改管理配置不补写历史表业务日期，也不代表真实 YTD Yield 已可比。配置变更沿用修订冲突检查和审计。

## 数据库准备

先检查可达性与实际表结构：

```powershell
.\.venv\Scripts\python.exe scripts/check_database.py
```

该脚本只读，不打印连接密码。

仅对空库基线，可使用历史完整建表脚本 [data_preparation_v1.sql](docs/database/data_preparation_v1.sql)。它一次创建预算、历史表现、用户权限、分配、快照、配置、参考数据和 Insight 表，并初始化工作台配置。脚本使用事务，仅适用于空表结构；若同名表仍存在会报错，应先核对实际表结构，不要用它覆盖或迁移现有数据。建表后可选择执行 [测试数据脚本](docs/database/quickwin_v14_test_seed.sql) 联调；测试数据脚本不能在正式库使用。

该 SQL 是历史初始结构，不能代替 V19 Alembic 升级。现有库先核对实际 revision 与迁移路径，禁止删表重建。2026-11-14 远端 `resource_dev` 已升级至 `20261114_03`；后续使用必须重新核对当前环境，不能仅凭文档假定状态。

V19 远端演练命令（默认回滚，显式 `--apply` 才提交；先配置正确 `APP_SETTINGS_FILE` 和 `APP_ENV`）：

```powershell
.\.venv\Scripts\python.exe scripts/migrate_v19_pg.py --expected-database resource_dev --report rehearsal.json --snapshot schema-before.json
.\.venv\Scripts\python.exe scripts/verify_v19_pg.py --report pg-acceptance.json
```

第一条复制受影响表做迁移演练；第二条使用隔离 schema / 回滚验收 PostgreSQL 行为。不要用正式业务行演示流转。执行条件和历史结果见 [V19 验收记录](../docs/V19_VALIDATION.md)。

脚本不注入真实用户或示例业务数据。首次使用前，维护 `data.user_permissions` 的 `email`（小写）、`display_name`、`role`、`department`、`sector`、`enabled`。角色为 `owner / lead / management / admin`；Owner 和负责人必须配置部门。Owner 的 `sector` 必须恰好一条，负责人可配置一至四条，管理层和管理员不配置业务线。管理员 API 只接受固定业务线 `PCMO / CRTO / B2B / OEM`。将既有预算的 `owner_email` 对应到真实启用 Owner。新预算可通过管理员 API 创建，Owner 必须与预算部门匹配。

V19 另有独立 `affiliation_sector` / `affiliation_department` 与 `history_resources` 字段，分别表示所属组织和费用覆盖配置，不能按授权范围猜填。费用权限按用户覆盖 > 所属部门 > 角色计算，缺归属不提供明细；历史账号需管理员维护真实归属。版本由管理员按业务日期创建、发布，勿将合成版本写入真实库。

## 启动与同站点部署

先在 `frontend` 运行 `npm ci`、`npm run build`，再在 `backend` 执行：

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir src --host 127.0.0.1 --port 8000
```

`serve_frontend = true` 且 `frontend/dist/index.html` 存在时，FastAPI 在 `/` 提供编译页面。`frontend_dist_path` 可显式指定部署后的绝对路径。开发时可加 `--reload`；应用主机用已有进程管理和反向代理运行相同服务。无额外队列或服务组件。

- 页面：`http://127.0.0.1:8000/`
- OpenAPI：`/docs`、`/openapi.json`（由 `docs_enabled` 控制）
- 存活检查：`/health`，不代表数据库可用
- 完整联调契约：[接口文档](docs/接口文档.md)

旧开发邮箱入口携带 `X-User-Email`，后台读取启用用户权限并应用参数化过滤；`APP_ENV=production` 明确拒绝这个身份方式。Portal JWT / Cookie 入口使用独立会话依赖与 CSRF 校验，配置和验收见 [Portal 接入说明](../deploy/portal-jwt.md)。配置字段、开发邮箱测试不能证明真实 SSO 已接通。管理员也不自动获得 Owner 草稿修改权限。

Azure Blob 只用于保留的旧模板下载和测试上传；V19 Excel 回传由前端解析、预览后提交整项 JSON，不依赖 Blob。公开测试上传受 `azure_blob_test_upload_enabled` 控制，正式环境关闭。

## 验证

必须在 `backend` 目录运行，测试使用自己的配置与本地数据库，不连接开发 PostgreSQL：

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check src tests scripts migrations
.\.venv\Scripts\python.exe -m mypy src
```

本地浏览器合成数据服务可用以下命令启动，仅供验收，不部署：

```powershell
.\.venv\Scripts\python.exe -m uvicorn tests.v19_prototype_fixture:app --app-dir src --host 127.0.0.1 --port 8019
```

该服务将最新 V19 原型导出导入被忽略的 `.cache/v19-prototype/` SQLite，与远端真实 PG 数据隔离。直接访问 `http://127.0.0.1:8019/`，在顶部切换原型中的人物/角色，使用 `example.test` 本地合成账号。它不读取开发 PG/AI 凭据，不调用外部 AI；已有本地库保留验收操作。旧 `tests.v19_browser_fixture` 及 `.cache/v19-final/` 的简化测试场景仍保留，不会被导入覆盖。原型 JSON 位于 `tests/fixtures/v19_prototype_demo.json`，原型 HTML 保持原样。模拟指标和月份不得写入远端真实数据。

在仓库根目录可重新提取（需要已有 Playwright 与 Edge/Chromium）：

```text
node backend/scripts/export_v19_prototype.cjs --source <V19.html> --playwright-module <node_modules/playwright> --browser <浏览器可执行文件>
```

导出执行全部最终脚本覆盖，保留 `historySnapshot.manifest`，不会访问数据库或读取应用凭据；默认输出 `backend/tests/fixtures/v19_prototype_demo.json`。202612/202701 均属于2027规划年，项目键为 `versionId|initiativeId`；原型全局经销商池没有Sector，映射时必须说明本地组织身份展开，不能当作真实组织归属。导出原值的 Vol/合同为KL、历史金额为美元基本单位，进入现有模型时 Vol/合同需转L；规划金额为CNY。源JSON保留10月快照和两版0确认；本地seed另以 `derivedLocalPreparation` 记录通过正常PlanningService确认202612齐交部门的测试准备，202701保留22提交0确认。派生准备不改变纯源导出，也不进入远端PG。

真实外部验收仍需应用身份、PG/Databricks 连接、授权数据与部署环境。历史 V19 的 696 项后端测试和 31 项 PG 隔离检查仅是当时版本证据，后续变更需重新选择验证范围；不能据此声称本次 shadcn 界面、真实 SSO 或 UAT 已通过。
