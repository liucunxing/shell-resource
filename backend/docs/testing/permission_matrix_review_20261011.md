# 权限矩阵核验（2026-10-11）

核验代码：`main`，`621b15e2b657fb9f3e6df5c09f2f2cc96423847b`。本地无未提交改动时执行 `git pull --ff-only`，从 `67372c5` 快进到该提交。

依据：[飞书权限矩阵](https://bba12hub36.feishu.cn/sheets/HcNusjG8xhAdyctxyA4cXDMDnPb?sheet=1gowPA)，读取版本 revision 165，A1:T200 全量读取，无截断，有效内容为 A1:E18。

**结论：未全部符合。17 个业务条目中，8 项符合当前权限边界，8 项存在明确差异，1 项需要确认口径。** 用户于 2026-10-11 明确第18行“所有”为所有经销商的表现均可见，不受 Sector 或已同步项目限制。当前测试通过不等于通过此矩阵验收。此次仅验证实现、更新字典与核验文档，未修改业务权限逻辑、发布或部署。

## 逐项核验

| 飞书行 | 条目 | 结果 | 当前行为与证据 |
|---|---|---|---|
| 2 | Initiative 预算及 Owner 信息 | 符合 | Owner 按邮箱及部门取本人；Lead 取本部门；Management 取范围内最新同步快照；Admin 取全部预算配置。`WorkspaceService.get_workspace/_scope`。 |
| 3 | 当前分配、其他预算、说明 | 不符合 | Owner/Lead 边界符合，Management 不读草稿；矩阵允许 Admin 查看，但其草稿接口 403，工作台分配及其他预算被投影为空。 |
| 4 | 编辑分配、其他预算、保存草稿 | 符合 | 仅本人 Owner 可写；Lead/Management/Admin 被后端拒绝；负向 API 测试覆盖。 |
| 5 | Excel 回传修改分配 | 符合 | 前端预览/确认按 Owner 归属限制；后端草稿和分配导入写入口同样限制；批量校验失败保持事务原子性。 |
| 6 | 提交项目 | 符合 | 仅本人 Owner 可 publish；要求经销商及其他预算之和等于预算总额；其他角色不能代提交。 |
| 7 | 查看同步历史版本 | 不符合 | Owner/Lead/Management 可读授权版本；Admin 访问 publications 返回 403，前端同样禁止。 |
| 8 | 查看业务汇总 | 不符合 | Owner 本人、Lead 本部门及 Management 最新快照正确；Admin 仅预算配置，未提供分配/其他预算业务汇总。 |
| 9 | 新增预算、调整总额、分配 Owner | 符合 | `AdminService._require_admin` 强制 Admin；校验 Owner 启用与所属部门。项目 Sector 当前不受 Owner.sector 限制。 |
| 10 | 导入历史参考 | 符合权限门禁 | 仅 Admin 可调用。另有功能限制：导入写 `workspace_references`，当前展示主源仍是 `distributor_sellin_resource_history`；导入兼容表不会改变当前主历史展示。 |
| 11 | 原因字典与全局业务指引维护 | 符合 | 仅 Admin，可用原因校验、版本与冲突校验由后端执行。 |
| 12 | 生成百炼 Insight | 不符合 | Owner 本人/项目与 Lead 本部门可调用百炼；Management POST generate 返回 403，仅 GET 计算最新同步快照预览，不调用模型。Admin 禁止符合。 |
| 13 | 修改分析提示词 | 不符合 | 矩阵允许 Admin；目前所有角色 PUT prompt 均被拒绝，提示词由版本化能力包维护。前端保留的本地演示 engine 逻辑不构成在线接口能力。 |
| 14 | 查看操作日志 | 不符合 | Owner/Lead 返回对应项目日志，Management 不返回；Admin 只返回预算/配置/导入/用户维护类日志，排除了 DRAFT_SAVE 和 PUBLISH。 |
| 15 | 导出数据 | 符合当前可见范围门禁 | RawPage 按角色投影导出当前筛选 CSV；Owner 可导出回传 Excel，Admin 可导出预算配置。Admin 不可导出分配/同步内容，与第3/7/8行差异相关。 |
| 16 | 历史“总资源”口径 | 待确认 | 原矩阵四角色均为“待确认”。代码/建表无 resource_total 列，不直接下发总资源列；不能据此选定全资源或部门资源业务口径。 |
| 17 | 历史资源类型列 | 不符合 | Owner 按部门裁资源列；Management/Admin 可见全部。Lead 调用 ReferenceService 时未传 department，且前端把 Lead 视为全资源范围，MKT Lead 收到 ICE Rebate/Capex，超过矩阵“部门资源类型”。 |
| 18 | 历史经销商表现“所有” | 不符合 | 用户已确认要求所有经销商的表现均可见。当前 Owner 按其 Sector 筛选，Management 仅取最新同步项目涉及的经销商，两者不符合；Lead/Admin 当前全量符合。全部经销商的 Vol/C3/Yield 可见要求不改变第17行资源类型列的部门权限边界。 |

## 实际复现

[核验脚本](verify_permission_matrix_20261011.py) 使用内存 SQLite 独立 schema、合成身份与经销商，调用真实服务和查询。脚本观察并断言当前差异；脚本执行成功表示差异稳定复现，**不表示差异符合要求**。

[JSON 证据](permission_matrix_evidence_20261011.json)：

- Owner 先提交 100，再将工作稿改为 70；Management 仍收到 100，验证未同步草稿隔离。
- Admin 草稿与同步版本读取均为 403，workspace 当前 rows 为空。
- Owner 保存与提交日志共 3 条；同一场景 Admin 收到 0 条，验证日志过滤。
- MKT Owner 历史资源为 MRD/SP&A；MKT Lead 实际返回 MRD/SP&A/ICE Rebate/Capex。
- Owner 历史经销商 d1/d2；Lead/Admin d1/d2/d3；Management 仅 d1。
- Management generate 与 Admin prompt update 实际返回 403。

执行结果：后端 `python -m pytest` **82 passed**；前端 `npm test -- --reporter=dot` **16 test files / 70 tests passed**；专项核验脚本全部观察断言通过。

核验范围为本地代码、API/服务测试、前端投影/导出实现。未核验部署环境的 PostgreSQL 实际列与迁移状态、生产 SSO、真实 Databricks 及百炼连接，也未开展浏览器交互验收。

## 数据字典更新依据

已全量读取原在线 12 张数据字典（A1:T202，无截断），按当前 ORM、完整建表脚本、迁移及服务实际读写核对；测试数据为原有合成样例，不代表线上真实数据。

- `user_permissions`：补 sector（VARCHAR(32)[]）、Owner 1条 / Lead 1–4条 / 管理层与管理员不配置，以及部门 Lead 覆盖规则；明确 Sector 历史过滤与项目归属过滤的区别。
- `distributor_sellin_resource_history`：补 sector（VARCHAR(100)）；原 resource_total/resource_uc3 保留并标为“当前代码/建表不含、不读取、不下发，外部扩展列未核验”，不伪造数据库现状；明确 Yield 是来源比值、BTL 映射 SP&A。
- `insight_prompts/insight_records`：标注能力包提示词、禁止在线编辑、生成角色、兼容版本及当前 result/evidence/access/metadata 结构。
- `workspace_references/workspace_config/historical_performance`：区分实际主源与兼容表；标注兼容导入不替换当前主源。
- `budgets/budgets_distributor/other_budgets/workspace_publications/budget_change_logs`：明确金额、revision、提交快照、权限范围与日志字段映射。

在线写入与回读结果见 [字典更新记录](data_dictionary_update_20261011.json)。仅修改字典说明与新增缺失的 sector 行，权限矩阵原文保持不变，便于保留验收基准。完整建表脚本保留的 operator_name/request_id 两列没有 ORM 映射，字典标注“应用不写入、不下发”，没有删掉数据库脚本中的真实字段。

## 后续处理建议

优先处理第17行 Lead 的跨部门历史资源可见性。第18行需调整 Owner/Management 的历史表现经销商范围，使所有经销商的 Vol/C3/Yield 均可见，同时保留第17行按部门裁剪资源类型列的要求。第3/7/8/14行管理员可见范围、第12行管理层百炼调用、第13行管理员编辑提示词，需要在保持矩阵或调整产品规则之间明确选择后实现。仅第16行总资源口径尚未形成可验收标准。
