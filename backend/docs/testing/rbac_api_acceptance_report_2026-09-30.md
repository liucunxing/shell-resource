# 资源规划工作台 RBAC 后端 API 验收报告（修复复验）

> 状态更新：之后已确认 Lead 为全局唯一角色，不按部门限制历史数据。因此，本报告中“Lead 历史仅限本部门”的复验结论已被后续需求更新取代，不再作为当前验收基线。当前实现已恢复 Lead 全量历史数据。

## 1. 结论

针对已启动的本地服务 `http://127.0.0.1:8000` 修复 Lead 历史数据范围后，已重新完成 **93** 项 API 验收：**93 项全部通过**。

修复后，MKT Lead 项目分配涉及 6 家经销商，工作台中带历史明细的经销商也只有 6 家，无额外经销商；发送的 2025 资源字段仅含 MKT 获准的 `MRD`、`SP&A`。与正式权限矩阵一致。

## 2. 执行信息

| 项目 | 内容 |
|---|---|
| 实际执行时间 | 2026-10-01 00:42:37 至 00:43:36（Asia/Shanghai） |
| 服务地址 | `http://127.0.0.1:8000` |
| API 前缀 | `/api/v1/workbench` |
| 身份方式 | `X-User-Email: <测试邮箱>` |
| 数据年度 | 2027 |
| 测试脚本 | [run_rbac_api_acceptance.py](run_rbac_api_acceptance.py) |
| 原始逐项证据 | [rbac_api_acceptance_evidence.json](rbac_api_acceptance_evidence.json) |
| 执行结果 | 93 PASS / 0 FAIL |

测试前，前端验收已经改变了种子数据：A_DRAFT 被转给 Owner B、预算调整为 100001，且已有多个同步版本。因此本次脚本不硬编码种子 Budget ID，而是从工作台投影动态解析当前 Owner 项目；实际用于写入验收的是 Budget ID `9`（A_DRIFT，Owner A）。

## 3. 测试范围与目的

| 范围 | 目的 | 代表端点 |
|---|---|---|
| 身份识别 | 证明请求头不是可任意伪造的身份 | `GET /workspace` |
| 工作台投影 | 证明每种角色只返回其允许的数据范围 | `GET /workspace?planning_year=2027` |
| 草稿与版本 | 证明 Owner 可写本人项目；Lead 可只读部门项目；Management/Admin 无草稿权限 | `GET/PUT /initiatives/{id}/draft`、`GET /publications` |
| 分配与 Excel | 证明分配 CRUD、Excel 回传仅 Owner 可操作，失败不写入 | `/distributor-allocations`、`/import` |
| 管理配置 | 证明只有 Admin 可以维护预算/Owner、全局指南、历史导入入口 | `/admin/budgets`、`/admin/config`、`/admin/reference` |
| Insight | 证明 Owner/Lead 可在各自范围维护提示词；Management 只预览；Admin 无业务 Insight 权限 | `/insights`、`/insights/prompt`、`/insights/generate` |
| 日志与快照 | 证明 Management 不返回日志，且只读取最新同步快照 | `GET /workspace`、`GET /publications` |

## 4. 角色权限与实际数据范围

### 4.1 Owner

| 验证项 | 实际结果 | 证明的权限 |
|---|---|---|
| Owner A 工作台 | 返回 Owner A 的 A_DRIFT；Owner B、ICE Owner 项目未返回 | Owner 只能看到本人 Initiative |
| Owner B 工作台 | 返回 A_DRAFT、B_PUBLISHED；两项 Owner 均为 Owner B | 项目归属以服务端 `owner_email` 为边界 |
| ICE Owner 工作台 | 仅返回 ICE_PUBLISHED | 跨部门项目不泄露 |
| Owner A 读本人草稿 | `200` | 可读本人当前工作稿 |
| Owner A 读 Owner B/ICE 项目 | `404` | 不泄露未授权项目是否存在 |
| Owner A 保存本人草稿 | `200`，revision 从 3 推进到 4 | 可保存本人草稿 |
| Owner A 用旧 revision 再保存 | `409` | 并发版本保护生效 |
| 重复/未知经销商编码 | 均为 `422` | 服务端校验重复和主数据存在性 |
| Owner A 同步配平项目 | `200`，生成新 publication，`publishedRevision=4` | 只有 Owner 能同步本人配平项目 |
| Owner A 经销商新增、修改、删除 | 均为 `200`；零金额临时行已删除 | Owner 可维护本人分配 |
| Owner A Excel 回传 | 合法 `.xlsx` 为 `200`，非 xlsx 为 `400` | Owner 可回传，文件格式有服务端校验 |
| Owner A 历史参考 | 1,278 家目录中仅 2 家带历史明细，均属于本人项目分配经销商 | Owner 历史明细范围正确；无历史的目录项仅用于选择经销商 |

### 4.2 部门负责人（Lead）

| 验证项 | 实际结果 | 证明的权限 |
|---|---|---|
| Lead 工作台 | 仅返回 MKT / PCMO 项目（A_DRAFT、A_DRIFT、B_PUBLISHED） | 部门、Sector 范围过滤生效 |
| Lead 读取 MKT 草稿 | `200` | 可只读本部门工作稿 |
| Lead 读取 ICE 草稿 | `404` | 跨部门数据隔离有效 |
| Lead 保存草稿、创建分配、Excel 回传 | 均为 `403` | Lead 无代替 Owner 编辑、回传或同步权限 |
| Lead 读取 MKT 同步历史 | `200` | 可查看本部门项目版本 |
| Lead 读取/修改 MKT Insight 提示词 | `200`；旧提示词版本为 `409` | 部门 Insight 与版本保护有效 |
| Lead 生成 Insight | `503`，错误为“百炼 AI 尚未配置” | 已通过 RBAC，失败原因是下游环境未配置，不是权限问题 |
| Lead 历史参考 | 6 家有历史明细，项目也涉及 6 家；无额外经销商，资源字段仅 `MRD`、`SP&A` | Lead 历史数据范围与部门授权正确 |

### 4.3 管理层（Management）

| 验证项 | 实际结果 | 证明的权限 |
|---|---|---|
| 管理层工作台 | 返回 4 个已同步快照；每项均有 `publishedAt` 与 `publishedRevision` | 未同步草稿不进入管理层投影 |
| 管理层草稿读取/保存 | `403` | 不可读取或编辑工作稿 |
| 管理层读取同步历史 | `200` | 可通过版本接口读取权限范围内的版本 |
| 管理层操作日志 | `state.audit=[]` | 当前不返回日志 |
| Management Insight | `200`，`record.status=preview`、`prompt.editable=false` | 只能查看同步数据分析预览 |
| 生成 Insight、修改提示词、分配回传 | 均为 `403` | 不调用百炼、不编辑提示词、不修改业务分配 |
| 最终快照核对 | Owner 当前 revision `9`；Management 最新 `publishedRevision=4` | 管理层读取的是已同步快照，不会读取 Owner 后续未同步草稿 |

### 4.4 管理员（Admin）

| 验证项 | 实际结果 | 证明的权限 |
|---|---|---|
| Admin 工作台 | 返回全部预算配置；每项 `rows=[]`、`otherBudgets=[]` | 管理员可看配置信息，但不下发业务分配明细 |
| Admin 用户信息 | 返回 6 个测试用户；其他角色 `users=[]` | 人员/权限配置只对 Admin 可见 |
| Admin 草稿、同步历史、业务分配 | 草稿和 publications 为 `403`；创建分配、Excel 回传均为 `403` | 管理员不代替 Owner 操作业务工作稿 |
| Admin 预算/Owner 维护 | 同值更新 `200`；过期 revision `409`；Owner 调用同接口 `403` | 管理配置权限与并发保护有效 |
| Admin 新增预算 | `200`；重复业务键 `409`；ICE Owner 分配给 MKT 项目 `422` | 可新增合法预算，且业务键和 Owner 部门/Sector 均受校验 |
| Admin 保存全局指南 | `200`；旧 config revision `409` | 全局业务指引仅 Admin 可维护 |
| Admin 读取/生成/修改 Insight | 均为 `403` | Admin 无业务 Insight 权限 |
| Admin 管理日志 | 仅返回配置类动作，不返回 `rows`/`otherBudgets` | 管理日志和业务明细隔离 |

## 5. 反向权限与数据完整性

| 场景 | 预期 | 实测 |
|---|---|---|
| 不带 `X-User-Email` 调工作台 | `401` | PASS |
| 未配置邮箱调工作台 | `403` | PASS |
| Owner 访问他人草稿 | `404` | PASS |
| Lead/Management/Admin 保存 Owner 草稿 | `403` | PASS |
| Owner 旧 revision 保存 | `409` | PASS |
| 重复经销商、未知经销商 | `422` | PASS |
| Lead/Management/Admin 回传 Excel | `403` | PASS |
| Owner 向他人项目回传 Excel | `404` | PASS |
| 非 Admin 维护预算、指南、历史导入 | `403` | PASS |
| 重复 Initiative 业务键 | `409` | PASS |
| MKT 项目分配 ICE Owner | `422` | PASS |
| Management/Admin 生成 Insight | `403` | PASS |
| Owner/Lead 旧提示词版本更新 | `409` | PASS |

## 6. Lead 历史参考数据范围修复与复验

| 项目 | 结果 |
|---|---|
| 用例 | `REF-LEAD` |
| 调用 | `GET /api/v1/workbench/workspace?planning_year=2027`，`X-User-Email: sf-mkt-lead@example.test` |
| 修复 | Lead 先从本部门项目的当前分配收集经销商编码，再按该编码集和 MKT 资源范围查历史。其他经销商只作为无 `history` 的选择目录返回。 |
| 正式预期 | 仅返回 MKT/PCMO 项目涉及经销商的历史明细及本部门获准资源字段 |
| 实际 | 有 `history` 的经销商 6 家，项目分配 6 家，额外历史明细 0 家；`resources2025` 仅包含 `MRD`、`SP&A` |
| 结论 | Pass |

复验证据保存在 `rbac_api_acceptance_evidence.json` 的 `REF-LEAD` 记录中。

## 7. 未纳入通过率的项目

| 项目 | 原因 |
|---|---|
| Admin 正向“年度整批替换历史参考数据” | 未执行。`POST /admin/reference` 当前写入 `data.workspace_references`，而工作台已改为读取 `data.distributor_sellin_resource_history`；执行正向导入会替换非活动表且无法证明工作台历史实际切换。已验证非 Admin 为 `403`、Admin 使用过期 config revision 为 `409`。 |
| Owner/Lead 正向百炼 Insight 生成 | 两者请求均通过角色校验，但本地服务返回 `503：百炼 AI 尚未配置`。这应按环境依赖未配置处理，不应记为 RBAC 失败。 |
| CSV 公式注入 | 当前 CSV 在前端本地生成，后端没有 CSV 导出端点；应保留前端验收结果，不计入本 API 报告。 |

## 8. 测试数据变更与清理

为证明 Admin 正向新增预算权限，两次 API 验收共创建了两条可识别测试数据：

```text
Budget ID: 12
Initiative: [RBAC-TEST] API-管理员新增-20260930124647
Owner: sf-owner-a@example.test
Budget: 1

Budget ID: 13
Initiative: [RBAC-TEST] API-管理员新增-20260930164310
Owner: sf-owner-a@example.test
Budget: 1
```

Owner 分配 CRUD 和 Excel 导入使用零金额临时行，均已通过 API 删除；草稿 revision 和同步版本会作为验收日志保留。

如需将全部 RBAC 测试数据恢复为种子前状态，可执行 [rbac_acceptance_cleanup.sql](rbac_acceptance_cleanup.sql)，再按需要重跑 [rbac_acceptance_seed.sql](rbac_acceptance_seed.sql)。这两个脚本会移除/重建所有名称以 `[RBAC-TEST]` 开头的测试 Initiative，不会处理正式业务数据。

## 9. 复现命令

```powershell
python backend/docs/testing/run_rbac_api_acceptance.py
```

脚本将刷新 [rbac_api_acceptance_evidence.json](rbac_api_acceptance_evidence.json)。它会对 `[RBAC-TEST]` Initiative 进行可审计的保存、同步和临时零金额分配操作，并新增一条 `[RBAC-TEST] API-管理员新增-*` 预算；因此只应在测试环境执行。
