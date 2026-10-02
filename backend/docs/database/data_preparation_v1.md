# V1.4 数据库建表说明

[data_preparation_v1.sql](data_preparation_v1.sql) 是当前唯一的完整建表脚本，适用于已经删除旧表的空 PostgreSQL 数据库。脚本在一个事务中创建全部 11 张表，并初始化 `data.workspace_config` 的单行配置；不插入用户或业务数据。如果同名表仍存在，脚本会报错，不会把已有结构当作最新结构跳过。

预算业务键为 `planning_year + sector + department + resource_type + initiative_name`。`data.budgets.owner_email` 记录 Initiative 执行人，用户角色及单一部门/Sector 范围存在 `data.user_permissions`。经销商分配记录通过 `budget_id` 关联预算；V1.4 工作台直接读取 `data.distributor_sellin_resource_history` 中的历史表现，`btl_2025` 在接口中映射为 `SP&A`。

建表后先维护 `data.user_permissions`，再创建预算并设置 `owner_email`。本地或 UAT 联调可执行 [quickwin_v14_test_seed.sql](quickwin_v14_test_seed.sql)，它插入测试身份和 Initiative。正式业务邮箱和真实项目负责人需单独核对录入。

本脚本不是 Alembic migration，也不负责未来已有数据的结构升级。任何后续有数据的数据库变更，需要单独设计迁移步骤。
