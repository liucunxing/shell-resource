# Shell Resource

Distributor 资源投资规划与追踪工具。本仓库采用前后端分离的 Monorepo 结构。

```text
shell-forecast/
├─ backend/             # Python 3.11 + FastAPI 后端
├─ frontend/            # 前端工程与页面原型
├─ docs/                # 项目和协作说明
├─ .gitignore
└─ README.md
```

## 后端

后端安装、环境配置、启动、Swagger 和测试说明见 [backend/README.md](backend/README.md)。

后端采用单一配置文件保存全部环境参数：

- `backend/.env`：提交到 Git，默认选择 development；
- `backend/config/settings.toml`：保存 development、test、production 配置；
- Git 提交无密码的环境选择器和 `settings.example.toml`，不提交真实 `settings.toml` 或密码。

## 前端

正式前端工程尚未初始化，现有静态业务原型保存在 `frontend/prototypes/`。

## Git 协作

建仓、远程绑定和分支协作流程见 [docs/GITHUB_WORKFLOW.md](docs/GITHUB_WORKFLOW.md)。日常开发在功能分支完成，通过 Pull Request 合并到 `main`。
