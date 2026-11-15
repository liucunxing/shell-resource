# 两个分支分别测试

两个分支从同一工程快照创建，分别保留自己的工作目录、数据缓存、前端构建和测试报告。仓库根目录的 `test-profile.json` 只记录模式，不存放数据库连接或凭据。

| 分支 | `mode` | 启动地址 | 数据与身份 |
| --- | --- | --- | --- |
| `test/v19-local-demo` | `local-prototype` | `http://127.0.0.1:8019` | V19 原型演示数据导入本地 SQLite；直接访问并使用本地合成角色切换 |
| `test/v19-pg-real` | `pg-real` | `http://127.0.0.1:8020` | 显式配置的远端 PG 真实业务数据；普通应用入口继续原有身份校验 |

每个分支的配置分别为：

```json
{ "mode": "local-prototype" }
```

```json
{ "mode": "pg-real" }
```

`scripts/Start-Branch.ps1` 与 `scripts/Test-Branch.ps1` 根据该文件选择入口。缺少配置或模式不合法时停止，不自动猜测环境。脚本不切换 Git 分支、不安装依赖、不运行迁移，也不修改连接配置。端口由模式固定，避免两个实例争用同一入口。

## 本地原型分支

在该分支工作目录根执行。先确保 Python 依赖可用，且该工作目录的 `frontend/dist/index.html` 已构建：

```powershell
pwsh -NoProfile -File ./scripts/Test-Branch.ps1
pwsh -NoProfile -File ./scripts/Start-Branch.ps1
```

启动脚本在前台运行 `tests.v20_prototype_fixture:app`，仅监听 loopback。访问 `http://127.0.0.1:8019`，无需登录或帆软跳转。数据来自提交到仓库的原型导出 `backend/tests/fixtures/v19_prototype_demo.json`，首次启动按V20权限适配后写入本工作目录的 `backend/.cache/v20-prototype/`；旧的 `.cache/v19-final/` 不受影响。该目录会保留本地操作结果，修改原型导出不会自动覆盖已导入的数据库。

测试脚本仅执行 `test_local_preview.py`、`test_v19_prototype*.py` 和 `test_v20_prototype*.py`，使用安全示例配置与 SQLite，不接远端 PG。本地模式拒绝 `-SettingsFile`，防止误以为原型测试正在验收真实数据。

## 远端 PG 分支

每次运行必须显式传入已有的安全 TOML 配置文件，脚本固定选择 `[development]`，不读取或输出配置内容：

```powershell
pwsh -NoProfile -File ./scripts/Test-Branch.ps1 -SettingsFile 'C:/secure/resource-settings.toml'
pwsh -NoProfile -File ./scripts/Start-Branch.ps1 -SettingsFile 'C:/secure/resource-settings.toml'
```

上面的路径是示例，替换为已获准使用的本机配置路径。凭据文件不得提交到 Git。启动使用 `app.main:app`，不会注入本地合成用户或演示数据。要从同一端口访问页面，TOML 的 `[development]` 必须已有 `serve_frontend = true`，并且 `frontend_dist_path` 指向本分支已构建的前端；缺省构建路径为本分支 `frontend/dist`。该配置由应用读取，不使用 `SERVE_FRONTEND` 环境变量覆盖。

PG 测试按顺序运行以下现有验证脚本；任何一步失败即停止：

1. `assess_sellin_pg.py`：只读评估真实 sell-in 历史数据及字段覆盖。
2. `verify_v19_pg.py`：在事务内创建隔离 QA schema，验证 V19 流程后回滚。
3. `verify_sellin_live_pg.py`：读取真实历史行，在隔离 QA schema 内验证映射与流程后回滚，并检查 QA schema 已消失。

这三个步骤不把原型或 SQLite 数据导入真实业务表，也不迁移或重置远端数据库。验证所需的临时 QA schema 权限不足时会失败并保留报告；不能将其解释为真实业务功能已通过。测试成功同样不替代数据口径确认或逐页视觉验收。

## Python、报告与环境恢复

默认使用本分支 `backend/.venv/Scripts/python.exe`。如复用已经装好依赖的解释器，两个脚本都支持显式指定：

```powershell
pwsh -NoProfile -File ./scripts/Test-Branch.ps1 -Python 'C:/venvs/resource/Scripts/python.exe'
```

PG 模式还须传入 `-SettingsFile`。测试报告保存在当前工作目录的 `outputs/branch-tests/<模式>-<时间>/`，本地为 JUnit XML，PG 为各步骤 JSON；这些目录不进入 Git。失败时检查该目录中已经生成的报告。

脚本结束后恢复调用进程原有的 `APP_ENV`、`APP_SETTINGS_FILE`、`PYTHONPATH` 和工作目录。启动脚本以前台方式运行，使用 Ctrl+C 停止；如需后台启动，在外部使用隐藏窗口启动进程并分别保留日志。

## 2026-11-15 验证记录

- 共同功能代码：`72c6d5b`，试算无历史对象边界修复 `d7d5823` 同步至两个测试分支；两分支跟踪文件的差异仅为 `test-profile.json`。
- 后端全量 738 项通过，Ruff 通过，Mypy 90 源文件通过。前端全量 334 项通过；两个 worktree 分别安装依赖并构建，包检查均通过。
- 本地默认 `Test-Branch.ps1` 9 项通过；独立 `.venv`、`node_modules`、`dist`、SQLite 与报告目录均已建立，没有指向其他 worktree 的链接。
- PG 默认测试入口（显式传安全配置）完成只读扫描、31 项隔离 V19 检查和 16 项真实全量接入检查；1,489 行全部映射一致，无身份覆盖；测试事务回滚、临时 schema 已清理。
- 浏览器实测：本地免登录、10 演示角色；月份从10改9，刷新保留并同步Owner期间，再恢复10；13被阻止；1440px和390px无页面横向溢出，管理层202612确认基线图表显示，无页面异常。
- PG 测试前后均为1,489行，源表指纹同为 `dc1d6e2460b013ee63195897cc49bcff`；无真实业务写入。
- 本地预览由 local-demo worktree 的 `Start-Branch.ps1` 启动于 `http://127.0.0.1:8019`。远端应用服务器未部署；PG分支正常应用入口仍保留鉴权。
- 本地原型的120全局经销商为适配Sector权限映射到480个Sector身份，不改变源项目预算、分配或预留；跨Sector合计家数不等于原型全局家数。原型合同和月份虽保留在导出/manifest，当前历史API仍按已接字段提供；这些适配限制不等于真实数据验收通过。

待确认的业务口径和数据见 [METRIC_DEFINITIONS.md](METRIC_DEFINITIONS.md)。V19视觉效果仍须用户确认，不把测试通过视为视觉或完整UAT通过。

## 2026-11-15 指标口径修复补充

共同实现fcf9d5c；main与PG分支同步，本地分支b509b32合入，跟踪差异仅test-profile.json。前端345项/后端739项通过；两个worktree构建和bundle通过，本地9项通过，PG31项流程＋16项全量接入通过且业务源指纹未变。本轮修改、实测和剩余边界见[指标实现验证](METRIC_IMPLEMENTATION_VALIDATION.md)。
