# 资源投资工作台后端 V1.4

FastAPI + SQLAlchemy Async + PostgreSQL。沿用 `Controller → Service → Repository → DO`：请求校验在 DTO，业务规则和事务在 Service，明确的数据查询在 Repository。无权限缓存、Agent 框架或向量库。

## 安装与配置

在 `backend` 目录执行（项目目标 Python 3.11）：

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
# 仅在本地配置尚不存在时复制，避免覆盖已有密钥
if (!(Test-Path config/settings.toml)) {
    Copy-Item config/settings.example.toml config/settings.toml
}
```

`backend/.env` 仅保存 `APP_ENV=development`，可提交。真实 `config/settings.toml` 被 Git 忽略，配置分为 `[development]`、`[test]`、`[production]`。进程环境变量 `APP_ENV` 可以覆盖环境选择，`APP_SETTINGS_FILE` 可指定配置文件。改动配置后重启应用。

编辑 `[development]`：

```toml
database_url = "postgresql+asyncpg://USER:URL_ENCODED_PASSWORD@HOST:5432/resource_dev?ssl=require"
serve_frontend = true
ai_api_key = ""
ai_base_url = ""
ai_model = "qwen-plus"
ai_timeout_seconds = 60
```

填写真实数据库连接，密码中的特殊字符必须 URL 编码。百炼 key 仅填在本地 `ai_api_key`；Base URL 复制控制台的兼容地址，按地域填写业务空间，参见[百炼官方接入文档](https://help.aliyun.com/zh/model-studio/first-api-call-to-qwen)。后端只发送已授权范围内的证据，单次生成六点解释；缺配置、超时或不合规模型响应会保留旧分析，草稿和同步不依赖 AI。

## 数据库准备

先检查可达性与实际表结构：

```powershell
.\.venv\Scripts\python.exe scripts/check_database.py
```

该脚本只读，不打印连接密码。本机目前连接 PostgreSQL 5432 超时；尚未验证远端实际结构，也未执行迁移。

核对通过后，由可达数据库的环境执行 [V1.4 增量 SQL](docs/database/quickwin_v14_increment.sql)。该文件包含本期预算关联、用户权限、其他预算、同步快照、配置、参考数据和 Insight 表，**已包含 AI 表，不要再重复执行独立 Insight 脚本**。脚本使用事务；旧分配记录无法唯一匹配预算时中止，先修正数据再执行。旧 [数据准备 DDL](docs/database/data_preparation_v1.sql) 是历史设计材料，不作为本次部署脚本。

脚本不注入真实用户或示例业务数据。首次使用前，维护 `data.user_permissions` 的 `email`（小写）、`display_name`、`role`、`department`、`sector`、`enabled`。角色为 `owner / lead / management / admin`；Owner 和负责人必须配置部门，Sector 为空表示不额外限定该字段。将既有预算的 `owner_email` 对应到真实启用 Owner。新预算可通过管理员 API 创建，Owner 必须与预算部门和 Sector 匹配。

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

开发环境业务请求必须携带 `X-User-Email`，后台查询权限表后拼接参数化过滤条件。它不是生产登录方案：`APP_ENV=production` 下业务接口直接返回 401，必须先接入可信身份来源。现有 SSO 配置字段尚不代表已接通企业登录。管理员也不自动获得 Owner 草稿修改权限。

Azure Blob 只用于保留的旧模板下载和测试上传；V1.4 Excel 回传由前端解析、预览后提交整项 JSON，不依赖 Blob。公开测试上传受 `azure_blob_test_upload_enabled` 控制，正式环境关闭。

## 验证

必须在 `backend` 目录运行，测试使用自己的配置与本地数据库，不连接开发 PostgreSQL：

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check src tests scripts
.\.venv\Scripts\python.exe -m mypy src
```

本地浏览器合成数据服务可用以下命令启动，仅供验收，不部署：

```powershell
.\.venv\Scripts\python.exe -m uvicorn tests.browser_fixture:app --app-dir src --host 127.0.0.1 --port 8014
```

其 SQLite 文件位于被忽略的 `.cache/`，与远端数据隔离。页面登录可用 `owner-a@example.test`、`owner-b@example.test`、`lead@example.test`、`manager@example.test`、`admin@example.test`，均为合成验收身份。这个本地服务也读取 `config/settings.toml` 的 `[development]` 中三个 AI 字段；填写 key/兼容地址并重启后，可用合成数据验证真实百炼，但数据库始终使用本地 SQLite。完整外部验收仍需 PostgreSQL 网络可达、实际结构核对及真实权限初始化。
