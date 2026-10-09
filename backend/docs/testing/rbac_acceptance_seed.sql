-- RBAC acceptance data for the 2027 workbench.
-- Scope: rows whose Initiative name starts with [RBAC-TEST] and example.test users only.
-- Prerequisite: data.distributor_sellin_resource_history contains at least 8 non-empty codes.
-- This script is rerunnable. It replaces only its own [RBAC-TEST] business rows.

BEGIN;

DO $$
BEGIN
    IF to_regclass('data.user_permissions') IS NULL
       OR to_regclass('data.budgets') IS NULL
       OR to_regclass('data.distributor_sellin_resource_history') IS NULL THEN
        RAISE EXCEPTION 'Required workbench tables are missing';
    END IF;
    IF (
        SELECT COUNT(DISTINCT distributor_code)
        FROM data.distributor_sellin_resource_history
        WHERE NULLIF(BTRIM(distributor_code), '') IS NOT NULL
    ) < 8 THEN
        RAISE EXCEPTION 'At least 8 distributor history codes are required';
    END IF;
END $$;

CREATE TEMP TABLE rbac_test_dealers (
    slot INTEGER PRIMARY KEY,
    distributor_code VARCHAR(255) NOT NULL UNIQUE
) ON COMMIT DROP;

INSERT INTO rbac_test_dealers (slot, distributor_code)
SELECT ROW_NUMBER() OVER (ORDER BY distributor_code), distributor_code
FROM (
    SELECT DISTINCT distributor_code
    FROM data.distributor_sellin_resource_history
    WHERE NULLIF(BTRIM(distributor_code), '') IS NOT NULL
    ORDER BY distributor_code
    LIMIT 8
) AS selected;

INSERT INTO data.user_permissions
    (email, display_name, role, department, enabled)
VALUES
    ('sf-admin@example.test',      '测试管理员',       'admin',      NULL,  TRUE),
    ('sf-management@example.test', '测试管理层',       'management', NULL,  TRUE),
    ('sf-mkt-lead@example.test',   '测试市场部负责人', 'lead',       'MKT', TRUE),
    ('sf-owner-a@example.test',    '测试执行人 A',     'owner',      'MKT', TRUE),
    ('sf-owner-b@example.test',    '测试执行人 B',     'owner',      'MKT', TRUE),
    ('sf-ice-owner@example.test',  '测试 ICE 执行人',  'owner',      'ICE', TRUE)
ON CONFLICT (email) DO UPDATE
SET display_name = EXCLUDED.display_name,
    role = EXCLUDED.role,
    department = EXCLUDED.department,
    enabled = EXCLUDED.enabled,
    updated_at = CURRENT_TIMESTAMP;

CREATE TEMP TABLE rbac_old_budget_ids (id BIGINT PRIMARY KEY) ON COMMIT DROP;
INSERT INTO rbac_old_budget_ids (id)
SELECT id
FROM data.budgets
WHERE planning_year = 2027
  AND initiative_name LIKE '[RBAC-TEST]%';

DELETE FROM data.workspace_publications
WHERE budget_id IN (SELECT id FROM rbac_old_budget_ids);
DELETE FROM data.other_budgets
WHERE budget_id IN (SELECT id FROM rbac_old_budget_ids);
DELETE FROM data.budgets_distributor
WHERE budget_id IN (SELECT id FROM rbac_old_budget_ids);
DELETE FROM data.budget_change_logs
WHERE budget_id IN (SELECT id FROM rbac_old_budget_ids);
DELETE FROM data.budgets
WHERE id IN (SELECT id FROM rbac_old_budget_ids);

DELETE FROM data.insight_records
WHERE planning_year = 2027
  AND (
      scope IN ('owner:sf-owner-a@example.test', 'owner:sf-owner-b@example.test', 'MKT')
      OR scope LIKE 'initiative:%'
  )
  AND created_by_email LIKE 'sf-%@example.test';

DELETE FROM data.insight_prompts
WHERE planning_year = 2027
  AND scope IN ('owner:sf-owner-a@example.test', 'owner:sf-owner-b@example.test', 'MKT');

INSERT INTO data.budgets
    (
        planning_year, sector, department, resource_type, initiative_name,
        plan_budget_amount, allocate_budget_amount, owner_email,
        revision, status, input_source
    )
VALUES
    (2027, 'PCMO', 'MKT', 'MRD',
     '[RBAC-TEST] A-未配平草稿', 100000.00, 90000.00,
     'sf-owner-a@example.test', 2, 0, 'RBAC_TEST'),
    (2027, 'PCMO', 'MKT', 'SP&A',
     '[RBAC-TEST] A-发布后已修改', 120000.00, 120000.00,
     'sf-owner-a@example.test', 3, 0, 'RBAC_TEST'),
    (2027, 'PCMO', 'MKT', 'MRD',
     '[RBAC-TEST] B-已发布', 80000.00, 80000.00,
     'sf-owner-b@example.test', 1, 1, 'RBAC_TEST'),
    (2027, 'PCMO', 'ICE', 'ICE Rebate',
     '[RBAC-TEST] ICE-已发布', 60000.00, 60000.00,
     'sf-ice-owner@example.test', 1, 1, 'RBAC_TEST');

CREATE TEMP TABLE rbac_test_budgets (
    code VARCHAR(32) PRIMARY KEY,
    id BIGINT NOT NULL
) ON COMMIT DROP;

INSERT INTO rbac_test_budgets (code, id)
SELECT CASE initiative_name
           WHEN '[RBAC-TEST] A-未配平草稿' THEN 'A_DRAFT'
           WHEN '[RBAC-TEST] A-发布后已修改' THEN 'A_DRIFT'
           WHEN '[RBAC-TEST] B-已发布' THEN 'B_PUBLISHED'
           WHEN '[RBAC-TEST] ICE-已发布' THEN 'ICE_PUBLISHED'
       END,
       id
FROM data.budgets
WHERE planning_year = 2027
  AND initiative_name LIKE '[RBAC-TEST]%';

INSERT INTO data.budgets_distributor
    (
        budget_id, planning_year, sector, department, resource_type,
        initiative_name, distributor_code, distributor_budget_amount,
        input_source, description
    )
SELECT b.id, 2027, 'PCMO', 'MKT', 'MRD', '[RBAC-TEST] A-未配平草稿',
       d.distributor_code, amounts.amount, 'RBAC_TEST', amounts.description
FROM rbac_test_budgets b
JOIN (VALUES
    (1, 35000.00::NUMERIC, 'Owner A 草稿分配 1'),
    (2, 25000.00::NUMERIC, 'Owner A 草稿分配 2')
) AS amounts(slot, amount, description) ON TRUE
JOIN rbac_test_dealers d ON d.slot = amounts.slot
WHERE b.code = 'A_DRAFT'
UNION ALL
SELECT b.id, 2027, 'PCMO', 'MKT', 'SP&A', '[RBAC-TEST] A-发布后已修改',
       d.distributor_code, amounts.amount, 'RBAC_TEST', amounts.description
FROM rbac_test_budgets b
JOIN (VALUES
    (3, 50000.00::NUMERIC, 'Owner A 当前草稿分配 1'),
    (4, 30000.00::NUMERIC, 'Owner A 当前草稿分配 2')
) AS amounts(slot, amount, description) ON TRUE
JOIN rbac_test_dealers d ON d.slot = amounts.slot
WHERE b.code = 'A_DRIFT'
UNION ALL
SELECT b.id, 2027, 'PCMO', 'MKT', 'MRD', '[RBAC-TEST] B-已发布',
       d.distributor_code, amounts.amount, 'RBAC_TEST', amounts.description
FROM rbac_test_budgets b
JOIN (VALUES
    (5, 30000.00::NUMERIC, 'Owner B 分配 1'),
    (6, 20000.00::NUMERIC, 'Owner B 分配 2')
) AS amounts(slot, amount, description) ON TRUE
JOIN rbac_test_dealers d ON d.slot = amounts.slot
WHERE b.code = 'B_PUBLISHED'
UNION ALL
SELECT b.id, 2027, 'PCMO', 'ICE', 'ICE Rebate', '[RBAC-TEST] ICE-已发布',
       d.distributor_code, amounts.amount, 'RBAC_TEST', amounts.description
FROM rbac_test_budgets b
JOIN (VALUES
    (7, 25000.00::NUMERIC, 'ICE 分配 1'),
    (8, 20000.00::NUMERIC, 'ICE 分配 2')
) AS amounts(slot, amount, description) ON TRUE
JOIN rbac_test_dealers d ON d.slot = amounts.slot
WHERE b.code = 'ICE_PUBLISHED';

INSERT INTO data.other_budgets (budget_id, reason_id, amount, note)
SELECT id, 'reserve', 30000.00, '尚差 10000，专用于未配平测试'
FROM rbac_test_budgets WHERE code = 'A_DRAFT'
UNION ALL
SELECT id, 'other', 40000.00, '当前草稿；不同于已发布快照'
FROM rbac_test_budgets WHERE code = 'A_DRIFT'
UNION ALL
SELECT id, 'reserve', 30000.00, 'Owner B 已发布预留'
FROM rbac_test_budgets WHERE code = 'B_PUBLISHED'
UNION ALL
SELECT id, 'other', 15000.00, 'ICE 已发布其他预算'
FROM rbac_test_budgets WHERE code = 'ICE_PUBLISHED';

-- A_DRIFT publication is revision 2. Its current revision 3 rows above are different,
-- proving that management reads the immutable publication instead of the live draft.
INSERT INTO data.workspace_publications
    (budget_id, department, publication_number, published_revision, snapshot, note)
SELECT b.id, 'MKT', 1, 2,
       json_build_object(
           'initiative', json_build_object(
               'id', b.id::TEXT,
               'name', '[RBAC-TEST] A-发布后已修改',
               'resourceType', 'SP&A',
               'sector', 'PCMO',
               'department', 'MKT',
               'ownerId', 'sf-owner-a@example.test',
               'budget', 120000.00,
               'rows', json_build_array(
                   json_build_object('dealerId', d3.distributor_code, 'amount', 40000.00, 'note', '发布版本分配 1'),
                   json_build_object('dealerId', d4.distributor_code, 'amount', 30000.00, 'note', '发布版本分配 2')
               ),
               'otherBudgets', json_build_array(
                   json_build_object('id', 'published-other-a', 'reasonId', 'other', 'amount', 50000.00, 'note', '发布版本其他预算')
               ),
               'revision', 2,
               'reserve', 0,
               'nonDealer', 50000.00,
               'status', 'completed'
           ),
           'reference', json_build_object(
               'batchId', 'data.distributor_sellin_resource_history',
               'asOf', '2026', 'planningYear', 2027
           ),
           'guideVersion', 1
       ),
       'RBAC 测试：发布后草稿已发生变化'
FROM rbac_test_budgets b
JOIN rbac_test_dealers d3 ON d3.slot = 3
JOIN rbac_test_dealers d4 ON d4.slot = 4
WHERE b.code = 'A_DRIFT';

INSERT INTO data.workspace_publications
    (budget_id, department, publication_number, published_revision, snapshot, note)
SELECT b.id, source.department, 1, 1,
       json_build_object(
           'initiative', json_build_object(
               'id', b.id::TEXT,
               'name', source.initiative_name,
               'resourceType', source.resource_type,
               'sector', 'PCMO',
               'department', source.department,
               'ownerId', source.owner_email,
               'budget', source.budget,
               'rows', source.rows,
               'otherBudgets', source.other_budgets,
               'revision', 1,
               'reserve', source.reserve,
               'nonDealer', source.non_dealer,
               'status', 'completed'
           ),
           'reference', json_build_object(
               'batchId', 'data.distributor_sellin_resource_history',
               'asOf', '2026', 'planningYear', 2027
           ),
           'guideVersion', 1
       ),
       source.note
FROM rbac_test_budgets b
JOIN (
    SELECT
        'B_PUBLISHED'::VARCHAR AS code,
        'MKT'::VARCHAR AS department,
        '[RBAC-TEST] B-已发布'::VARCHAR AS initiative_name,
        'MRD'::VARCHAR AS resource_type,
        'sf-owner-b@example.test'::VARCHAR AS owner_email,
        80000.00::NUMERIC AS budget,
        json_build_array(
            json_build_object('dealerId', d5.distributor_code, 'amount', 30000.00, 'note', 'Owner B 分配 1'),
            json_build_object('dealerId', d6.distributor_code, 'amount', 20000.00, 'note', 'Owner B 分配 2')
        ) AS rows,
        json_build_array(
            json_build_object('id', 'published-other-b', 'reasonId', 'reserve', 'amount', 30000.00, 'note', 'Owner B 已发布预留')
        ) AS other_budgets,
        30000.00::NUMERIC AS reserve,
        0.00::NUMERIC AS non_dealer,
        'RBAC 测试：Owner B 已发布'::TEXT AS note
    FROM rbac_test_dealers d5
    JOIN rbac_test_dealers d6 ON d6.slot = 6
    WHERE d5.slot = 5
    UNION ALL
    SELECT
        'ICE_PUBLISHED', 'ICE', '[RBAC-TEST] ICE-已发布', 'ICE Rebate',
        'sf-ice-owner@example.test', 60000.00,
        json_build_array(
            json_build_object('dealerId', d7.distributor_code, 'amount', 25000.00, 'note', 'ICE 分配 1'),
            json_build_object('dealerId', d8.distributor_code, 'amount', 20000.00, 'note', 'ICE 分配 2')
        ),
        json_build_array(
            json_build_object('id', 'published-other-ice', 'reasonId', 'other', 'amount', 15000.00, 'note', 'ICE 已发布其他预算')
        ),
        0.00, 15000.00, 'RBAC 测试：ICE 已发布'
    FROM rbac_test_dealers d7
    JOIN rbac_test_dealers d8 ON d8.slot = 8
    WHERE d7.slot = 7
) AS source ON source.code = b.code;

INSERT INTO data.budget_change_logs
    (budget_id, operation_type, before_data, after_data, operator_id, operation_note)
SELECT id, 'ADMIN_CREATE', NULL::JSON,
       json_build_object('testData', TRUE, 'initiative', code),
       'sf-admin@example.test', 'RBAC 测试数据初始化'
FROM rbac_test_budgets
UNION ALL
SELECT id, 'DRAFT_SAVE', NULL::JSON,
       json_build_object('revision', CASE WHEN code = 'A_DRIFT' THEN 3 ELSE 2 END),
       'sf-owner-a@example.test', 'RBAC 测试草稿保存'
FROM rbac_test_budgets
WHERE code IN ('A_DRAFT', 'A_DRIFT')
UNION ALL
SELECT id, 'PUBLISH', NULL::JSON, json_build_object('revision', 1),
       CASE code
           WHEN 'B_PUBLISHED' THEN 'sf-owner-b@example.test'
           ELSE 'sf-ice-owner@example.test'
       END,
       'RBAC 测试同步'
FROM rbac_test_budgets
WHERE code IN ('B_PUBLISHED', 'ICE_PUBLISHED');

INSERT INTO data.insight_prompts (planning_year, scope, text, version)
VALUES
    (2027, 'owner:sf-owner-a@example.test', 'RBAC 测试：仅分析 Owner A 当前授权项目。', 1),
    (2027, 'owner:sf-owner-b@example.test', 'RBAC 测试：仅分析 Owner B 当前授权项目。', 1),
    (2027, 'MKT', 'RBAC 测试：仅分析 MKT 部门当前授权项目。', 1)
ON CONFLICT (planning_year, scope) DO UPDATE
SET text = EXCLUDED.text,
    version = EXCLUDED.version,
    updated_at = CURRENT_TIMESTAMP;

COMMIT;

-- Read-only verification output. Expected: 6 users, 4 budgets, 8 current allocation
-- rows, 4 other-budget rows and 3 immutable publications.
SELECT email, role, department, enabled
FROM data.user_permissions
WHERE email LIKE 'sf-%@example.test'
ORDER BY role, email;

SELECT
    b.id, b.initiative_name, b.department, b.owner_email,
    b.plan_budget_amount, b.allocate_budget_amount, b.revision, b.status,
    COUNT(DISTINCT d.id) AS allocation_rows,
    COUNT(DISTINCT o.id) AS other_budget_rows,
    COUNT(DISTINCT p.id) AS publication_rows
FROM data.budgets b
LEFT JOIN data.budgets_distributor d ON d.budget_id = b.id
LEFT JOIN data.other_budgets o ON o.budget_id = b.id
LEFT JOIN data.workspace_publications p ON p.budget_id = b.id
WHERE b.planning_year = 2027
  AND b.initiative_name LIKE '[RBAC-TEST]%'
GROUP BY b.id
ORDER BY b.department, b.initiative_name;
