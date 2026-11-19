# V1.4 数据库建表说明

[data_preparation_v1.sql](data_preparation_v1.sql) 是当前唯一的完整建表脚本，适用于已经删除旧表的空 PostgreSQL 数据库。脚本在一个事务中创建全部 12 张表，并初始化 `data.workspace_config` 的单行配置；不插入用户或业务数据。如果同名表仍存在，脚本会报错，不会把已有结构当作最新结构跳过。

预算业务键为 `planning_year + sector + department + resource_type + initiative_name`。`data.budgets.owner_email` 记录 Initiative 执行人；`data.user_permissions.sector` 记录人员被授权的业务线：Owner 恰好一条，部门负责人（Lead）一至四条，管理层和管理员不配置。经销商分配记录通过 `budget_id` 关联预算。

Resource Studio V17 的经销商目录和历史表现统一读取已导入的 `data.distributor_sellin_resource_history`，不再依赖 Databricks 经销商维表。2026-11-13 确认：`distributor_status` 的源值 `1 = active`、`0 = closed`（客户称 close）；兼容数字和文本 1/0，接口统一返回英文状态。经销商业务口径仅包含所属业务线的 Active 经销商。拆分工作台以经销商范围的最终名单为准，试算、分配明细、保存及导出共用这份名单，保留已选零金额行。旧草稿或来源版本中已关闭经销商的金额退回待分配，其余经销商金额保持原值。 状态缺失的记录也排除。

`history`提供年度Vol/C3、完整历史投资总额及按授权可见的费用明细。`btl_2025 / btl_2026`映射为SP&A。源Vol为L、C3为USD、历史费用当前为USD；API的Vol/C3保留原值，历史费用除以配置汇率归一为USD，页面除1000显示KL、千美元、千美元。Yield由C3美元÷同期间完整费用美元重算，仅两者均>0且期间可比时有效；历史费用按配置汇率除算至美元、不带x/倍、负值显示“—”，不能解释为未来回报或ROI。YoY按(2025−2024)/2024重算并乘100，基期≤0为无基期；不直接采用源Yield/YoY。受限费用明细不下发，公共完整总额独立返回，不能以部分授权明细求和冒充总额。2026Actual/费用业务截止月未知时不算YTD Yield。当前源未提供合同和PPP，保持缺失。

已确认的 24 个字段不包含合同量，应用不新增或假设 `contract_2025/contract_2026`；原型合同量和 Phasing 显示 `—`。数据已导入的数据库无需重建表或重新导入。

2026-11-14：同编码历史按 `sector + distributor_code + sd + rsm` 独立展示和分配，不再按编码去重。API 的 `id` 为稳定记录标识，`code` 为原始经销商编码；前端选择、试算与分配使用 `id`，显示和导出保留 `code`。迁移 `20261114_01` 给 `data.budgets_distributor` 添加可空 `history_key/sd/rsm`，不改动源表及旧分配。旧分配没有归属时保持原编码，不猜测应归到哪个 RSM。Excel 模板新增 SD/RSM 和隐藏记录标识列，导入可按编码、SD、RSM 匹配记录。

已有数据库使用迁移 `20261112_01` 补齐上述字段。该迁移采用 `ADD COLUMN IF NOT EXISTS`，因此兼容 DBA 已提前执行部分或全部 DDL 的数据库；回滚应用时不删除这些数据源列。

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
