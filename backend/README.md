# Shell Forecast Backend

Distributor 资源投资规划与追踪工具的后端基础框架。当前版本只提供工程骨架、配置、数据库接入层、SSO 扩展口和测试接口，不包含任何业务逻辑。

## 技术栈

- Python 3.11
- FastAPI + Uvicorn
- Pydantic Settings（配置校验）
- SQLAlchemy 2.x Async + Alembic（DO 与数据库迁移）
- Pytest、Ruff、Mypy（测试与代码质量）

## 项目分层

```text
src/app/
├─ api/               # Controller/API 路由层
├─ services/          # Service 业务编排层
├─ repositories/      # Repository 数据访问层
├─ models/do/         # SQLAlchemy DO，映射数据库表
├─ schemas/dto/       # 前端请求 DTO
├─ schemas/vo/        # 返回前端的 VO
├─ db/                # 数据库连接和 Session
├─ core/              # 配置、日志、统一响应、异常处理
├─ security/          # SSO 抽象契约
├─ dependencies/      # FastAPI 依赖注入入口
├─ health/            # 运维健康检查
└─ main.py            # 应用工厂和启动入口
```

调用方向：`API → Service → Repository → DO/Database`。API 不直接访问数据库；DO 不作为页面返回对象，接口通过 DTO/VO 隔离数据库结构。

## 首次安装（Windows PowerShell）

先进入后端目录：

```powershell
cd D:\work\Develop\shell-forecast\backend
```

然后创建环境并安装依赖：

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements-dev.txt
Copy-Item .env.example .env
```

如果 PowerShell 阻止激活脚本，也可以始终使用 `.\.venv\Scripts\python.exe` 和 `.\.venv\Scripts\uvicorn.exe` 执行后续命令。

## 启动

```powershell
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --app-dir src --reload --host 127.0.0.1 --port 8000
```

启动后访问：

- Swagger UI: <http://127.0.0.1:8000/docs>
- ReDoc: <http://127.0.0.1:8000/redoc>
- 健康检查: <http://127.0.0.1:8000/health>
- 测试接口: <http://127.0.0.1:8000/api/v1/test/ping>

`GET /api/v1/test/ping` 的响应示例：

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

Swagger 中还可以调用 `POST /api/v1/test/echo`，用于验证请求体校验和统一响应结构。404、422、500 等异常也会返回同样的 `code/msg/data` 外壳。

## 多环境配置

配置按以下优先级覆盖（后者优先）：

1. `config/env/.env.<APP_ENV>`：项目内可提交的环境默认值；
2. 根目录 `.env`：本机私有覆盖，不进入 Git；
3. 操作系统或部署平台环境变量：生产环境推荐方式。

本地默认使用 `development`。切换测试环境：

```powershell
$env:APP_ENV = "test"
uvicorn app.main:app --app-dir src --reload
```

生产环境不要把密码提交到仓库。可以复制模板后在服务器填写，也可以直接由部署平台注入环境变量：

```powershell
Copy-Item config/env/.env.production.example config/env/.env.production
$env:APP_ENV = "production"
$env:DATABASE_URL = "postgresql+asyncpg://..."
$env:SSO_CLIENT_SECRET = "..."
uvicorn app.main:app --app-dir src --host 0.0.0.0 --port 8000
```

如果采用 PostgreSQL，还需把对应的异步驱动（例如 `asyncpg`）加入依赖；数据库产品尚未确认，因此当前开发环境使用 SQLite，避免提前绑定生产数据库。

## SSO 预留

- `src/app/security/sso.py` 定义与 SAML/OIDC 厂商无关的用户身份及认证器契约。
- `src/app/dependencies/auth.py` 是未来受保护接口统一引用的依赖入口。
- `SSO_ENABLED`、Issuer、Client ID、Client Secret 已进入配置模型。

在 SSO 协议、身份提供商、Claim/角色映射确定前，不实现伪登录。当前测试和健康接口为公开接口。

## 数据库迁移

新增 DO 后，先在 `src/app/models/do/__init__.py` 中导入该模型，再执行：

```powershell
alembic revision --autogenerate -m "create example table"
alembic upgrade head
```

## 验证与质量检查

```powershell
pytest
ruff check .
mypy src
```

## Git 说明

Git 仓库根目录位于后端目录的上一层。分支、提交和 Pull Request 流程见根目录的 `docs/GITHUB_WORKFLOW.md`。后端修改应在功能分支完成，不直接向 `main` 推送。
