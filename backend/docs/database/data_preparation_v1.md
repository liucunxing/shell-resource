# V1.4 数据库建表说明

[data_preparation_v1.sql](data_preparation_v1.sql) 是当前唯一的完整建表脚本，适用于已经删除旧表的空 PostgreSQL 数据库。脚本在一个事务中创建全部 12 张表，并初始化 `data.workspace_config` 的单行配置；不插入用户或业务数据。如果同名表仍存在，脚本会报错，不会把已有结构当作最新结构跳过。

预算业务键为 `planning_year + sector + department + resource_type + initiative_name`。`data.budgets.owner_email` 记录 Initiative 执行人；`data.user_permissions.sector` 记录人员被授权的业务线：Owner 恰好一条，部门负责人（Lead）一至四条，管理层和管理员不配置。经销商分配记录通过 `budget_id` 关联预算；V1.4 工作台直接读取 `data.distributor_sellin_resource_history` 中的历史表现，`btl_2025` 在接口中映射为 `SP&A`，`yield_2025` 作为原始 Yield 值下发。

建表后先维护 `data.user_permissions`，再创建预算并设置 `owner_email`。本地或 UAT 联调可执行 [quickwin_v14_test_seed.sql](quickwin_v14_test_seed.sql)，它插入测试身份和 Initiative。正式业务邮箱和真实项目负责人需单独核对录入。

本脚本不是 Alembic migration，也不负责未来已有数据的结构升级。任何后续有数据的数据库变更，需要单独设计迁移步骤。

已有数据库增加用户业务线：执行 Alembic 迁移 `20261009_01`，或由 DBA 执行以下一次性 DDL。不要重跑完整建表脚本，也不要加 `CASCADE`。约束先以 `NOT VALID` 方式创建，使现有 Owner/Lead 可在补齐业务线前保留；补齐后必须验证约束。

```sql
BEGIN;
ALTER TABLE data.user_permissions
    ADD COLUMN IF NOT EXISTS sector VARCHAR(32)[];

ALTER TABLE data.user_permissions
    ADD CONSTRAINT ck_user_permissions_role_sector_count
    CHECK (
        COALESCE(
            CASE role
                WHEN 'owner' THEN cardinality(sector) = 1
                WHEN 'lead' THEN cardinality(sector) BETWEEN 1 AND 2
                WHEN 'management' THEN COALESCE(cardinality(sector), 0) = 0
                WHEN 'admin' THEN COALESCE(cardinality(sector), 0) = 0
                ELSE FALSE
            END,
            FALSE
        )
    ) NOT VALID;

-- 补齐 Owner/Lead 的 sector 后执行：
ALTER TABLE data.user_permissions
    VALIDATE CONSTRAINT ck_user_permissions_role_sector_count;
COMMIT;
```

此操作只变更用户授权表，不改变 `data.budgets.sector` 及已有 Initiative 数据。`sector` 使用 PostgreSQL 数组：例如 Owner 为 `ARRAY['PCMO']`，Lead 最多可填四项，如 `ARRAY['PCMO', 'B2C', 'B2B', 'LUBES']`；管理层和管理员填 `NULL`。
