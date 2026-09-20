# 数据准备页 V1：DDL 说明

对应原型的“01 数据准备”页面，本版本只覆盖：

- 预算内容：在线新增、修改、删除，以及 Excel 导入；
- 历史表现：按年度、全年或季度、Distributor、Sector、Resource Type 保存 Vol、C3、Resource；
- 预算操作日志：预留用于记录新增、修改、删除；后续由预算 Service 在 CRUD 操作中显式写入。

可执行 DDL 位于 [data_preparation_v1.sql](data_preparation_v1.sql)。本文件是初步设计稿，尚未生成 Alembic migration，也未执行到任何数据库。

## 表与原型字段映射

| 原型区域 | 数据表 | 关键字段 |
| --- | --- | --- |
| STEP 1 预算内容 | `data.budgets` | `sector_code`、`department_code`、`resource_type_code`、`initiative_name`、`plan_budget_amount` |
| STEP 2 历史表现 | `data.historical_performance` | `history_year`、`period_code`、`sector_code`、`distributor_name`、`resource_type_code`、`volume`、`c3_value`、`resource_amount` |
| 预算操作日志 | `data.budget_change_logs` | `operation_type`、`before_data`、`after_data`、`changed_at` |

## 当前设计假设

1. `planning_year` 是预算数据的必要业务维度。原型的预算编辑表未展示该字段，后续页面可在“规划年度”上下文中统一选择或由接口参数传入。
2. 原型中的 `Quarter` 同时承载全年与季度，DDL 用 `period_code` 保存该期间标识；原型的 `FY`、`Q1` 至 `Q4` 仅为示例值。
3. 原型中的 `Resource` 按数值处理，DDL 映射为 `resource_amount NUMERIC(18,2)`；若客户确认其含义不是金额，需要改名和调整精度。
4. 原型用 `Sector + Department + Initiative` 作为预算项定位键；DDL 加上 `planning_year` 建唯一约束。`Resource Type` 保留为预算属性，但不参与唯一键。
5. 当前未实施登录，因此日志表中的操作人字段允许为空。SSO 完成后，再由预算 Service 填入操作人、请求标识和操作说明。

`Sector`、`Department`、`Resource Type`、`Initiative`、`Distributor` 和 `period_code` 均不使用枚举或固定值约束。原型中的下拉演示值只作为前端示例，不会限制客户后续导入或维护的数据。

## 后续确认后再做

- 把 DDL 转为 Alembic migration；
- 创建对应 SQLAlchemy DO、Repository、Service、Controller；
- 在预算 CRUD Service 中补充日志写入；
- 确认是否允许同一 Initiative 存在多个 Resource Type；
- 明确 `Resource`、`C3` 的业务含义和小数精度；
- 补充预计数据、适用范围、拆分、提交版本和 Tracking 表。
