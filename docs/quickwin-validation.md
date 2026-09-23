# V1.4 本地交付验收

日期：2026-09-23。基线 `main 4c44f03`，实施分支 `feature/v14-quickwin`。用户确认先用本地，应用服务器后续提供。本次没有向远端 PostgreSQL 写入数据或执行迁移，也没有推送 Git。

## 已实现

沿用 React + FastAPI + PostgreSQL 及 Controller → Service → Repository → DO。默认页面通过 API 读写；演示模式需显式开启。按邮箱查询权限并在查询中限制部门、Sector、Owner。工作数据使用关系表，快照与 Insight 结果使用 JSON。

草稿整项事务保存、修订冲突、其他预算、反复同步、不可变快照、部门只读、管理层同步视图、管理员预算/Owner/原因/指南/历史批次/日志均已接通。Excel 保留原前端解析和预览；确认后使用草稿或配置 JSON 接口，不调用旧追加上传接口。

百炼六点分析只调用一次兼容 API，由后端计算事实。提示词/指南、失败保留、依据过期、调用用户与当前范围检查均有实现。管理层只读计算预览不调用模型。未加入 Agent 框架、向量库、权限缓存、审批或实时协同。

## 自动验证

| 检查 | 结果 |
| --- | --- |
| 后端 pytest | 58 项通过，使用 SQLite 与真实 Service/API；模型调用使用受控 HTTP 模拟 |
| 后端 ruff | src / tests / scripts 通过 |
| 后端 mypy | 64 个源文件通过 |
| 前端 Vitest | 11 个文件、39 项通过 |
| 前端生产构建 | 通过；JS/JSX 未启用全量 checkJs，不等同于全部业务 JS 的类型检查 |
| OpenAPI / 接口文档 | 25 条路由均在唯一接口文档中有对应记录 |
| 密钥检查 | 本地 settings.toml 被忽略；待交付文件未发现已配置数据库密码或 AI key |
| Git diff 空白检查 | 通过 |

保留现有 ExcelJS 按需分包提示；后端测试有依赖弃用提示，均未导致失败。项目目标 Python 3.11，本机实际使用 Python 3.13 完成验证。

## 浏览器实测

本地 FastAPI 在 8014 提供实际生产构建与 API；业务数据仅为独立 `.cache/qa-*.sqlite` 中的合成数据。

- Owner A 只能看到项目 1，Owner B 只能看到项目 2；负责人能看本部门两项，明细没有保存按钮。
- 总预算 100 时，分配 80 可保存并在刷新后恢复，未配平时不能同步。补其他预算 20 及说明后同步成功，历史立即显示一条。
- 后续草稿分配改为 70，管理层仍展示已同步的 80；重启后端后草稿 70 和快照 80 均保留。
- Owner 下载真实 Excel，修改为分配 75、其他预算 25；预览、确认、刷新后仍只有一条分配。再次导入过期文件显示修订号错误并阻止写入。
- 管理员下载真实 Excel（真实邮箱、含 revision=0 的项目），修改项目 1 预算 100 → 120。预览显示 1 项变化、1 项不变；确认刷新后为 120 和 200，并显示操作者日志。管理层快照仍为预算 100 / 分配 80。
- 管理层六点只读预览成功；Owner 未配置 AI 时明确显示 503 提示，工作台继续可用。
- 开发邮箱切换通过页面操作完成，旧身份数据清空。桌面已查看编辑页、管理层与管理员截图；390px 管理层无整页横向溢出。

截图和真实往返 Excel 位于被忽略的 `frontend/output/playwright/`，包括 `owner-published.png`、`management-snapshot.png`、`mobile-management.png`、`admin-audit.png`、`owner-return.xlsx`、`admin-return.xlsx`。早期联调发现的登录 Hook 顺序、Insight 初始化、管理员演示 Owner 校验等问题已修复并复测。

## 使用和剩余外部验收

本地启动命令与测试邮箱见 [后端说明](../backend/README.md)。`backend/config/settings.toml` 的 `[development]` 已留出 `ai_api_key`、`ai_base_url`、`ai_model`；当前 key 和地址为空。填写后重启本地服务即可用合成数据验证百炼。

应用服务器到位后：从该主机检查 PostgreSQL → 核对实际列与旧数据关联 → 执行已审阅的增量 SQL → 初始化真实用户和 Owner → 跑真实 PostgreSQL/百炼联调。生产身份来源仍需接入；当前 production 配置拒绝开发邮箱头。本次结论为本地可联调，不是已完成正式部署。
