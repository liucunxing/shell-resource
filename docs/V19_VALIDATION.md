# V19 工程验收记录

> 视觉验收状态（2026-11-14）：用户已明确否定此前工程与最新 V19 原型的视觉一致性，指出布局、配色、顺序及图表均有差异。本文保留的是当时功能、构建和浏览器操作证据，不能解释为 V19 视觉保真通过。修复与同屏对照验收尚待完成；当前结果不应按“V19 已验收”交付。

基线：远端 `origin/feature_11_11_cx`，提交 `6e70ba5`（2026-11-14）。
开发分支：`feat/v19-prototype-20261114`。设计依据：同日最新版
`迭代需求/Distributor_Resource_Studio_HiFi_V19.html` 及其调整记录，按顶部最新规则实现。

## 验收范围

| 用户可见行为 | 功能检查 | 页面检查 | 状态 |
|---|---|---|---|
| 角色顶部导航及规划版本切换 | 四角色进入与选择版本 | 桌面首屏、390px 窄屏、长表滚动 | 本地通过 |
| Owner 三步编辑、保存、提交冻结 | 草稿保存、提交后按钮只读、旁路 API 拒绝 | 草稿和已提交状态 | 本地通过 |
| 部门全部提交才确认 | 缺项阻断、全部确认、管理层可见 | 确认清单与管理看板 | 本地通过 |
| 撤回仅取消确认，定向退回才开放修改 | 撤回/再次确认/按项目、Owner、全部门退回 | 必填原因、取消、焦点恢复 | 本地通过 |
| 新版本只继承最后提交快照 | 返回后未提交修改不继承、旧版本隔离 | 管理员创建、发布与关闭 | 本地及 PG 通过 |
| 公共历史总额与受限费用分离 | 用户/所属部门/角色优先级，缺归属无费用 | 管理员归属表单与历史列 | 本地通过 |
| 名单包含零投入且跨项目去重 | 历史分母不受搜索/排序/分页影响 | 名单、汇总、对比表 | 本地通过 |
| 版本比较保留退出项目/SD | 退出为 -100%、零基期新增、未确认不可比较 | 分组切换与数据缺失 | 本地通过 |
| 源数据口径诚实呈现 | manifest 与 records 同响应，无伪造截止月 | YTD、PPP、合同量缺失提示 | 本地通过 |

异常路径另检查：过期修订拒绝；无权限账号/模拟用户禁止写入；已确认项目不可直接退回；
截止/关闭版本拒绝写入；取消确认弹窗不改变数据；历史不齐不当作零。

## 本地环境

`backend/tests/v19_browser_fixture.py` 使用独立 SQLite 文件
`backend/.cache/v19-final/`，仅合成账号和合成业务数据；不读取真实数据库或 AI 凭据。
首次启动通过真实 Service 创建两版规划、4 个项目、3 个 Owner、2 个部门。
旧版已确认，调整版待提交，可验证完整流转。
浏览器验收在该隔离数据中另创建了 `202703`、发布并提交部分项目；启动已有文件会保留这些操作。

在 backend 目录以已安装项目依赖的 Python 运行：

```powershell
python -m uvicorn tests.v19_browser_fixture:app --app-dir src --host 127.0.0.1 --port 8019
```

编译前端后由同站点提供页面。合成账号：`owner-a@example.test`、`owner-b@example.test`、
`owner-ice@example.test`、`lead@example.test`、`lead-ice@example.test`、
`manager@example.test`、`admin@example.test`。

示例入口：

- Owner：`http://127.0.0.1:8019/?user_email=owner-a@example.test`
- 部门负责人：`http://127.0.0.1:8019/?user_email=lead@example.test`
- 管理层：`http://127.0.0.1:8019/?user_email=manager@example.test`
- 管理员：`http://127.0.0.1:8019/?user_email=admin@example.test`

这些邮箱只供本地合成数据夹具使用，不代表生产身份或 Portal 验收。

## 已知源数据边界

现有历史宽表仅有 2024/2025/2026 指标，无 Actual/费用业务月份、合同量和 PPP。
接口返回真实字段对应年份、未知截止月与缺失标记；改变规划年度不会改写源数据年份。
公共历史费用合计必须四项源值完整，缺失不会按零补齐。SQLite 功能检查不能替代 PostgreSQL
实际迁移、真实用户授权、SSO、部署和业务 UAT。

## 验证结果

2026-11-14 在 Windows 本机完成以下验证：

- 后端：696 项测试全部通过，无警告；Ruff 全量通过。
- 前端：51 个文件、289 项测试全部通过；TypeScript/Vite 生产构建和包检查通过。
- 浏览器：Edge，1440×960 与 390×844；实际操作保存/提交、齐交确认、撤回再确认、
  三种范围退回、取消弹窗、管理层可见性、创建并发布新版本、来源版本和退出 SD 对比。
- 最终视觉修复：清除旧五列表格百分比规则对 19 列编辑表的影响，表内横向滚动，
  仅操作列固定。桌面表宽 2350px、容器 1382px；390px 手机页宽仍为 390px，
  表格容器 360px，支持键盘方向键滚动及访问末列。最终页面未发现 JavaScript 异常。
- 独立复核：跨 Sector 名单校验、整数预算门禁、最后提交快照、SD/RSM 来源对比
  四项审查问题均已修复，相关 15 项后端与 18 项前端测试通过，无遗留 P1/P2。
- Mypy：原有 37 项类型错误已修复，`src` 及本轮两个 PG 脚本共 91 个文件检查通过。
- 追加修复：Portal 子应用挂载 V19 版本/部门接口，并用登录 Cookie、CSRF 和角色校验回归；
  首版复制时将唯一同 Sector 的旧经销商编码转换为当前历史标识，仅修改新版本副本。
  多组织歧义或归一化冲突明确返回 422，避免错误归属和唯一约束错误。
- ExcelJS：所有 Excel 读写在按需 Worker 内完成；移除主线程中的重复副本，编辑页约 58KB
  降至 45KB。构建无大包警告，未提高告警阈值；保留单份约 937KB 的 Worker 依赖。
  真实浏览器已验证初始页面不加载 ExcelJS、模板与目录下载、模板回传预览及取消无副作用。
- Alembic：修复 JSON 默认值冒号被识别成绑定参数的问题，离线 SQL 和 PG 演练均通过。

最终验证使用 Python 3.11.16 和受约束的项目运行依赖；后端 696 项测试全部通过，无警告。
Ruff 覆盖 `src tests scripts migrations`；本地 Uvicorn 使用同一 Python 3.11 环境启动成功。

工作区根目录 `outputs/v19-engineering-20261114/` 保存 `backend-junit.xml`、
`frontend-tests.json`、`browser-results.json`、页面截图、`pg-connectivity.md` 和离线升级 SQL。
追加证据：`frontend-bundle.json`、`browser-excel-results.json`、`pg-schema-before-apply.json`、
`pg-migration-rehearsal.json`、`pg-migration-applied.json`、`pg-v19-acceptance.json`、
`pg-live-readonly.json`。配置凭据、业务行和本地导出文件均未加入 Git。
主要截图：`owner-home.png`、`department-incomplete.png`、`department-confirmed.png`、
`department-single-return.png`、`management-confirmed.png`、`admin-versions.png`、
`admin-users.png`、`sd-exit-comparison.png`、`mobile-owner.png`、`owner-editor-final.png`、
`owner-editor-table-right.png`、`mobile-editor-table.png`。

## PostgreSQL 与交付边界

2026-11-14 19:50（+08:00），经用户授权，远端 `resource_dev` 已从 `20261102_01`
升级至 `20261114_03`。先复制受影响表至隔离 schema 演练，再用单个事务执行实际迁移；
锁等待超时为 5 秒，提交前比较原有列的行数及内容指纹，确认完全一致后提交。

| 原有数据 | 升级前 | 升级后 | 内容指纹 |
|---|---:|---:|---|
| 预算 | 24 | 24 | 一致 |
| 经销商分配 | 23 | 23 | 一致 |
| 经销商历史 | 1,564 | 1,564 | 一致 |
| 用户权限 | 20 | 20 | 一致 |
| 工作台配置 | 1 | 1 | 一致 |

真实 PostgreSQL 隔离 API 验收 31 项全部通过，覆盖 ARRAY、多版本、提交/确认/退回、
权限及完整回滚清理。升级后对 15 张业务 ORM 表进行只读校验，管理员、部门负责人、Owner、
管理层的工作台与版本接口均返回 200，管理员 ARRAY 部门筛选也返回 200。

复验命令（在 backend 目录，先通过环境变量设置现有配置路径，不复制凭据）：

```powershell
python scripts/migrate_v19_pg.py --expected-database resource_dev --report rehearsal.json --snapshot schema-before.json
python scripts/verify_v19_pg.py --report pg-acceptance.json
```

第一条默认只演练并回滚；显式增加 `--apply` 才提交升级。迁移保留业务数据和审计记录，
不提供删表式降级。应用回退应保留已升级字段与审计表。

20 个历史账号的独立所属 Sector/Department 原先不存在，本次未按授权范围猜填，
需管理员依据真实组织归属配置；未配置时不展示费用明细。原有角色及业务授权范围保持不变。
规划版本由管理员按业务日期创建、发布，不把本地合成版本写入真实库。

交付分支为 `feat/v19-prototype-20261114`；原 `shell-resource` 主工作树保留。
本轮已完成远端数据库升级与联调，未部署应用服务器；真实 SSO 和业务 UAT 不在本次验收结论内。
