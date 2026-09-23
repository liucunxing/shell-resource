# V1.4 Quick Win 实施约定

用户已批准年度分配闭环和百炼六点 Insight；沿用 V1.4 页面与普通 Controller → Service → Repository → DO。无 Tracking、审批、真实问数、实时协作。原型只读。不要写入远程业务数据库或导入演示数据；先核实实际结构，增量 SQL 交付审阅。

## 共享接口

前缀 `/api/v1/workbench`；沿用 `{code,msg,data}`。开发使用 `X-User-Email`，服务端查 `data.user_permissions` 得到唯一启用身份（email、display_name、role、department、sector 可空）。Owner 按预算 owner_email，Lead 按部门，可选 Sector 限制；management 只读已同步；admin 仅配置。production 不接受未经验证的邮箱头。金额请求允许十进制字符串，输出明确转换为前端可计算的数值，数据库及服务端用 Decimal。

- `GET /workspace?planning_year=2027` → `{identity,state,data,users}`。这是查询投影，不是整库 JSON 存储。`identity={key,email,role,department,ownerId:email,label}`，`state`/`data` 兼容 frontend engine 的字段形状，数据必须先在 SQL 层按权限过滤。管理员返回预算配置、可选 Owner 名单，不含分配、历史明细、快照、Insight。management 的 initiatives/publications 只来源于最新同步快照。无记录就是空数组，不注入 Mock。
- `GET /initiatives/{id}/draft` → 单项前端 Initiative（id 为 budget_id 的字符串）；`PUT` 同路由，请求 `{expected_revision,rows:[{dealerId,amount,note}],otherBudgets:[{id,reasonId,amount,note}]}` → 更新后单项。整批替换当前项工作稿；允许不平衡；负数/非法编码/非法原因拒绝；旧 revision 返回 409。
- `POST /initiatives/{id}/publish` 请求 `{expected_revision,note:""}` → publication。校验经销商+其他预算=预算；非零其他预算须说明；事务中追加不可变快照；草稿仍可编辑。
- `GET /initiatives/{id}/publications` → 当前权限下的历史数组。
- `PUT /admin/budgets` 请求 `{items:[{id,expected_revision,budget,ownerId}]}` → `{updated_count}`；已有配置批量更新，完整校验后同事务写入。`POST` 同路由用于初始化预算，请求 `{items:[{name,resourceType,sector,department,budget,ownerId}],planning_year}`。通过服务端用户清单验证 Owner 部门。
- `PUT /admin/config` 请求 `{expected_revision,budgetReasons?,guide?}` → 配置对象；配置包含 `revision,budgetReasons,budgetReasonVersion,guide:{version,text},reference`；保持简单配置记录，不创建配置框架。
- `POST /admin/reference` 请求 `{expected_revision,batchId,asOf,dealers:[{id,name,history:{vol2024,c32024,vol2025,c32025,vol2026Ytd,c32026Ytd,resources2025:{...}}}]}` → reference。保存规范化历史行，批次整批事务。null 表示缺失，不补零。Owner/Lead 返回许可资源明细及整体同年 Yield 比值，不返回未授权资源总额。
- `GET /insights?scope=owner:EMAIL&planning_year=2027` → `{record,prompt}`；`PUT /insights/prompt` 请求 `{scope,planning_year,text,expected_version}`；`POST /insights/generate` 请求 `{scope,planning_year}` → 六点 record。Owner 范围为本人集合或本人 initiative:ID；Lead 本部门；management 不可生成；admin 不可生成/读取。规则数字由后端算，AI 只提供解释；失败不覆盖旧记录，依据改变标记 stale。

现有 8 个接口保留，但固定身份替换为邮箱权限；旧 xlsx 导入仍为追加，须更新 revision/汇总并隔离 management/admin 写权限。新版 Excel 用前端解析/预览→结构化草稿接口，后端必须重验。

## 前后端投影约定

state 包含 schemaVersion:2、scenario:'api'、initiatives、departments（MKT/ICE/CAPEX 的 collecting 空结构）、reference、guide、insights、analysisPrompts、budgetReasons、budgetReasonVersion、publications、audit、final:null、configRevision。单项字段 name/resourceType/sector/department/ownerId/budget/rows/otherBudgets/revision/status/savedAt；status 为 draft，若有当前修订快照可为 completed。兼容汇总 reserve/nonDealer 来自其他预算。publication 字段 id/initiativeId/department/number/createdAt/publishedAt/publishedRevision/initiative/reference/guideVersion。data 包含 metadata、initiatives（同权限配置）、allocations:[]、dealers；不得引入 demo-data。

Insight record 与现有 InsightPanel 兼容（六点、证据、依据、生成时间、stale），具体字段由 AI worker 与前端 worker直接核对，但不得改变上述范围和 API。提示词和历史依据单独保持修订。

## 分工与验收

- BE：模型、仓储、工作台/管理服务/Controller、邮箱依赖、增量 SQL、业务集成测试（不改 core/config、main、requirements、AI模块、文档）。
- FE：frontend 内 API 模式、页面与 Excel/Insight 接线、测试和版本标识（不修改原型 HTML）。默认 API 模式，显式 demo 模式；接口失败不能回退为演示数据。
- AI：insight_service/controller/repository/model/schema/tests；与 BE 共享 scoped workspace 数据，不直接信任前端数字；配置由主线程提供。
- 主线程：配置、依赖、路由装配、单站点托管、接口文档、部署说明、独立审查和联调。

验收覆盖 Owner 横向隔离、草稿允许不平衡、同步守恒、同步后修改不污染快照、旧版本冲突、批量原子性、AI 超时/错误/越权、刷新恢复与文档一致。远端 PostgreSQL 和真实百炼未连通时明确记录，不能用 Mock 测试代替真实成功。
