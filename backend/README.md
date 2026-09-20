# Shell Forecast Backend

Distributor 资源投资规划与追踪工具的 Python 3.11 + FastAPI 后端基础框架。当前版本提供工程分层、统一响应、数据库接入、环境配置、SSO 扩展口和测试接口，不包含业务逻辑。

## 技术栈

- Python 3.11
- FastAPI + Uvicorn
- Pydantic（配置校验）
- SQLAlchemy 2.x Async + Alembic
- PostgreSQL 异步驱动 `asyncpg`
- Azure Blob Storage 异步 SDK
- Pytest、Ruff、Mypy

## 项目分层

```text
src/app/
├─ api/               # 路由聚合和版本前缀
├─ controllers/       # Controller：定义 HTTP 接口、参数和响应
├─ services/          # Service 业务编排层
├─ repositories/      # Repository 数据访问层
├─ models/do/         # SQLAlchemy DO，映射数据库表
├─ schemas/dto/       # 前端请求 DTO
├─ schemas/vo/        # 返回前端的 VO
├─ db/                # 数据库连接和 Session
├─ core/              # 配置、日志、统一响应、异常处理
├─ storage/           # Azure Blob 等外部对象存储适配器
├─ security/          # SSO 抽象契约
├─ dependencies/      # FastAPI 依赖注入入口
├─ health/            # 运维健康检查
└─ main.py            # 应用工厂和启动入口
```

调用方向：`Controller → Service → Repository → DO/Database`。Controller 不直接访问数据库；DO 不作为页面返回对象，接口通过 DTO/VO 隔离数据库结构。

## 首次安装（Windows PowerShell）

```powershell
cd D:\work\Develop\shell-forecast\backend
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements-dev.txt
Copy-Item config/settings.example.toml config/settings.toml
```

然后编辑 `config/settings.toml`，把 development 和 production 区域内的占位值换成当前环境可以使用的真实配置。该文件可能包含密码，已被 Git 忽略。

## 配置模型

项目只使用一个环境选择文件和一个本地配置文件：

```text
.env                  # 提交到 Git，默认选择 development
config/settings.toml  # 同时保存 development、test、production 三套配置
```

Git 中提交：

```text
 .env                         # 不包含密码，只选择环境
config/settings.example.toml
```

`config/settings.toml` 包含真实连接信息，仍然不提交 Git。

Azure Blob 测试上传配置位于各环境区域：

```toml
azure_blob_test_upload_enabled = true
azure_blob_account_url = "https://账户名.blob.core.chinacloudapi.cn"
azure_blob_account_key = "本地填写的存储账户密钥"
azure_blob_container_name = "容器名"
azure_blob_max_upload_bytes = 20971520
```

生产配置默认关闭测试上传接口。存储账户密钥只允许写入被 Git 忽略的
`config/settings.toml`，不得写入 `.env`、模板、代码或日志。

当前测试上传会把文件直接保存到配置容器的根目录，Blob 名称就是上传时的
原始文件名；同名文件不会被覆盖，接口会返回 409。

`.env` 支持以下环境名：

```dotenv
APP_ENV=development
```

也可以使用简写 `dev`、`test`、`prod`。程序根据 `APP_ENV` 读取 `settings.toml` 中同名区域：

```toml
[development]
debug = true
database_url = "开发数据库连接"

[production]
debug = false
database_url = "生产数据库连接"
```

修改 `.env` 或 `settings.toml` 后必须重启应用。系统环境变量 `APP_ENV` 可以临时覆盖 `.env` 中的环境选择；其他业务配置统一从选中的 TOML 区域读取。

仓库中的 `.env` 默认是 `APP_ENV=development`，因此新成员拉取代码后无需再复制 `.env`。生产服务器可以把该值改成 `production`；修改后的生产 `.env` 不应反向提交到 Git。

## 启动

```powershell
.\.venv\Scripts\Activate.ps1
python -m uvicorn app.main:app --app-dir src --reload --host 127.0.0.1 --port 8000
```

启动后访问：

- Swagger UI: <http://127.0.0.1:8000/docs>
- ReDoc: <http://127.0.0.1:8000/redoc>
- 健康检查: <http://127.0.0.1:8000/health>
- 测试接口: <http://127.0.0.1:8000/api/v1/test/ping>
- Azure Blob 测试上传: `POST /api/v1/test/blob/upload`（在 Swagger 选择文件）

统一响应示例：

```json
{
  "code": 200,
  "msg": "响应成功",
  "data": {
    "message": "pong",
    "environment": "development",
    "timestamp": "2026-09-17T00:00:00Z"
  }
}
```

## PyCharm 配置

- Module name：`uvicorn`
- Parameters：`app.main:app --app-dir src --reload --host 127.0.0.1 --port 8000`
- Working directory：`D:\work\Develop\shell-forecast\backend`
- Environment variables：留空，让 `.env` 决定当前环境
- Interpreter：项目约定的 Python 3.11 解释器

## 数据库迁移

新增 DO 后，先在 `src/app/models/do/__init__.py` 中导入模型，再执行：

```powershell
alembic revision --autogenerate -m "create example table"
alembic upgrade head
```

## 数据准备 DDL 初稿

数据准备页的预算、历史表现和预算变更日志初步设计位于：

- [DDL SQL](docs/database/data_preparation_v1.sql)
- [字段映射与设计假设](docs/database/data_preparation_v1.md)

该 DDL 当前仅供评审，尚未执行到数据库，也尚未转为 Alembic migration。

## 验证与质量检查

```powershell
pytest
ruff check .
mypy src
```

## SSO 预留

- `src/app/security/sso.py` 定义与 SAML/OIDC 厂商无关的用户身份及认证器契约。
- `src/app/dependencies/auth.py` 是未来受保护接口统一引用的依赖入口。
- SSO 的开关、Issuer、Client ID 和 Client Secret 存放在各环境 TOML 区域。

SSO 协议、身份提供商和 Claim/角色映射确定前，不实现伪登录。当前测试和健康接口为公开接口。

## Git 说明

Git 仓库根目录位于后端目录的上一层。`.env` 只包含环境选择，可以提交；真实 `config/settings.toml` 不得提交。分支和 Pull Request 流程见根目录 `docs/GITHUB_WORKFLOW.md`。
