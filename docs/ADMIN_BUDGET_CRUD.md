# 管理员项目配置操作

“预算与 Owner 映射”右上角提供“新增”，每行提供“编辑”和“删除”。新增、编辑使用同一个六字段表单：Initiative 名称、Sector、资源类型、部门、Owner 邮箱、预算金额。

校验沿用新增规则：名称和 Sector 必填并限制长度；预算非负、最多两位小数；资源类型忽略大小写并保存为 MRD / SP&A / ICE Rebate / Capex；Owner 必须为所选部门内已启用的 Owner 或部门负责人，邮箱忽略大小写。相同年度、Sector、部门、资源类型、名称不可重复。

编辑保留分配金额和原同步快照，更新分配行冗余的项目名称、部门、Sector、资源类型，并增加修订号、设置为待重新同步。修改归属后，需由新的 Owner 复核并重新同步。

删除须在弹窗中再次确认，会删除目标项目及经销商分配、其他预算、同步记录；删除前的完整快照写入后台 ADMIN_DELETE 操作日志，保留原有审计日志。页面没有撤销入口；需要恢复时由管理员按日志快照处理。上线此功能不会自动删除任何业务数据。

API（均仅管理员可调用）：

- `POST /api/v1/workbench/admin/budgets`：沿用新增接口，`{planning_year, items: [六字段对象]}`。
- `PUT /api/v1/workbench/admin/budgets/{id}`：六字段对象加 `expected_revision`。
- `DELETE /api/v1/workbench/admin/budgets/{id}`：JSON 请求体 `{expected_revision}`。

修订不匹配返回 409；项目不存在返回 404；资源类型或 Owner 无效返回 422。编辑、删除在单个数据库事务中执行，失败整笔回滚。无需数据库结构迁移。
