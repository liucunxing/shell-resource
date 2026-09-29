-- V1.4 local/UAT test seed data.
-- Run only after data_preparation_v1.sql has completed successfully.
-- The reserved example.test emails make these rows easy to identify as test data.

BEGIN;

DO $$
BEGIN
    IF to_regclass('data.user_permissions') IS NULL
       OR to_regclass('data.budgets') IS NULL THEN
        RAISE EXCEPTION
            'V1.4 tables are missing. Run data_preparation_v1.sql first.';
    END IF;
END $$;

-- 1. Seed enabled identities first. The backend resolves every request through
--    data.user_permissions before it enters a workbench service.
INSERT INTO data.user_permissions
    (email, display_name, role, department, sector, enabled)
VALUES
    ('sf-admin@example.test',      '测试管理员',       'admin',      NULL,  NULL,   TRUE),
    ('sf-management@example.test', '测试管理层',       'management', NULL,  NULL,   TRUE),
    ('sf-mkt-lead@example.test',   '测试市场部负责人', 'lead',       'MKT', 'PCMO', TRUE),
    ('sf-owner-a@example.test',    '测试执行人 A',     'owner',      'MKT', 'PCMO', TRUE),
    ('sf-owner-b@example.test',    '测试执行人 B',     'owner',      'MKT', 'PCMO', TRUE),
    ('sf-ice-owner@example.test',  '测试 ICE 执行人',  'owner',      'ICE', 'PCMO', TRUE)
ON CONFLICT (email) DO UPDATE
SET display_name = EXCLUDED.display_name,
    role = EXCLUDED.role,
    department = EXCLUDED.department,
    sector = EXCLUDED.sector,
    enabled = EXCLUDED.enabled,
    updated_at = CURRENT_TIMESTAMP;

-- 2. Seed three isolated Initiatives so the data-scope rules can be tested:
--    owner A and owner B must not see each other's Initiative;
--    the MKT lead can see both MKT Initiatives but not the ICE Initiative.
INSERT INTO data.budgets
    (
        planning_year,
        sector,
        department,
        resource_type,
        initiative_name,
        plan_budget_amount,
        allocate_budget_amount,
        owner_email,
        revision,
        status,
        input_source
    )
VALUES
    (2027, 'PCMO', 'MKT', 'MRD',
     '[TEST] 渠道增长 A', 100000.00, 0.00,
     'sf-owner-a@example.test', 0, 0, 'TEST_SEED'),
    (2027, 'PCMO', 'MKT', 'SP&A',
     '[TEST] 品牌活动 B', 80000.00, 0.00,
     'sf-owner-b@example.test', 0, 0, 'TEST_SEED'),
    (2027, 'PCMO', 'ICE', 'ICE Rebate',
     '[TEST] ICE 激励', 60000.00, 0.00,
     'sf-ice-owner@example.test', 0, 0, 'TEST_SEED')
ON CONFLICT
    (planning_year, sector, department, resource_type, initiative_name)
DO NOTHING;

COMMIT;

-- Verification: expected result is 6 enabled users and 3 test Initiatives.
SELECT email, display_name, role, department, sector, enabled
FROM data.user_permissions
WHERE email LIKE 'sf-%@example.test'
ORDER BY role, email;

SELECT
    id,
    planning_year,
    sector,
    department,
    resource_type,
    initiative_name,
    owner_email,
    revision,
    status
FROM data.budgets
WHERE planning_year = 2027
  AND initiative_name LIKE '[TEST]%'
ORDER BY department, initiative_name;
