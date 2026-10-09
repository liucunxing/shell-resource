-- Remove only the data created by rbac_acceptance_seed.sql.
BEGIN;

CREATE TEMP TABLE rbac_cleanup_budget_ids (id BIGINT PRIMARY KEY) ON COMMIT DROP;
INSERT INTO rbac_cleanup_budget_ids (id)
SELECT id
FROM data.budgets
WHERE planning_year = 2027
  AND initiative_name LIKE '[RBAC-TEST]%';

DELETE FROM data.workspace_publications
WHERE budget_id IN (SELECT id FROM rbac_cleanup_budget_ids);
DELETE FROM data.other_budgets
WHERE budget_id IN (SELECT id FROM rbac_cleanup_budget_ids);
DELETE FROM data.budgets_distributor
WHERE budget_id IN (SELECT id FROM rbac_cleanup_budget_ids);
DELETE FROM data.budget_change_logs
WHERE budget_id IN (SELECT id FROM rbac_cleanup_budget_ids);
DELETE FROM data.budgets
WHERE id IN (SELECT id FROM rbac_cleanup_budget_ids);

DELETE FROM data.insight_records
WHERE planning_year = 2027
  AND created_by_email LIKE 'sf-%@example.test';

DELETE FROM data.insight_prompts
WHERE planning_year = 2027
  AND scope IN ('owner:sf-owner-a@example.test', 'owner:sf-owner-b@example.test', 'MKT');

COMMIT;

