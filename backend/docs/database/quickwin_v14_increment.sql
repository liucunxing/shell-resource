-- V1.4 incremental schema. Review the live data schema first; this file has NOT been run remotely.
-- All changes run in one transaction. No sample data or user permissions are inserted.
BEGIN;
CREATE SCHEMA IF NOT EXISTS data;


CREATE TABLE IF NOT EXISTS data.budget_change_logs (
	id BIGSERIAL NOT NULL,
	budget_id BIGINT NOT NULL,
	operation_type VARCHAR(32) NOT NULL,
	before_data JSON,
	after_data JSON,
	operator_id VARCHAR(255),
	operation_note TEXT,
	changed_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_budget_change_logs PRIMARY KEY (id)
)

;


CREATE TABLE IF NOT EXISTS data.budgets (
	id BIGSERIAL NOT NULL,
	planning_year SMALLINT NOT NULL,
	sector VARCHAR(32) NOT NULL,
	department VARCHAR(32) NOT NULL,
	resource_type VARCHAR(64) NOT NULL,
	initiative_name VARCHAR(255) NOT NULL,
	plan_budget_amount NUMERIC(18, 2) NOT NULL,
	allocate_budget_amount NUMERIC(18, 2) NOT NULL,
	owner_email VARCHAR(255),
	revision INTEGER NOT NULL,
	status INTEGER NOT NULL,
	input_source VARCHAR(20) NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_budgets PRIMARY KEY (id)
)

;


CREATE TABLE IF NOT EXISTS data.budgets_distributor (
	id BIGSERIAL NOT NULL,
	budget_id BIGINT,
	planning_year SMALLINT NOT NULL,
	sector VARCHAR(32) NOT NULL,
	department VARCHAR(32) NOT NULL,
	resource_type VARCHAR(64) NOT NULL,
	initiative_name VARCHAR(255) NOT NULL,
	distributor_code VARCHAR(255) NOT NULL,
	distributor_budget_amount NUMERIC(18, 2) NOT NULL,
	input_source VARCHAR(20) NOT NULL,
	description VARCHAR(255),
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_budgets_distributor PRIMARY KEY (id)
)

;


CREATE TABLE IF NOT EXISTS data.insight_prompts (
	id BIGSERIAL NOT NULL,
	planning_year SMALLINT NOT NULL,
	scope VARCHAR(300) NOT NULL,
	text TEXT NOT NULL,
	version INTEGER NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_insight_prompts PRIMARY KEY (id)
)

;


CREATE TABLE IF NOT EXISTS data.insight_records (
	id BIGSERIAL NOT NULL,
	planning_year SMALLINT NOT NULL,
	scope VARCHAR(300) NOT NULL,
	signature VARCHAR(80) NOT NULL,
	prompt_version INTEGER NOT NULL,
	reference_batch_id VARCHAR(128),
	guide_version INTEGER NOT NULL,
	created_by_email VARCHAR(255) NOT NULL,
	record JSON NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_insight_records PRIMARY KEY (id)
)

;


CREATE TABLE IF NOT EXISTS data.other_budgets (
	id BIGSERIAL NOT NULL,
	budget_id BIGINT NOT NULL,
	reason_id VARCHAR(64) NOT NULL,
	amount NUMERIC(18, 2) NOT NULL,
	note VARCHAR(500),
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_other_budgets PRIMARY KEY (id)
)

;


CREATE TABLE IF NOT EXISTS data.user_permissions (
	id BIGSERIAL NOT NULL,
	email VARCHAR(255) NOT NULL,
	display_name VARCHAR(255) NOT NULL,
	role VARCHAR(32) NOT NULL,
	department VARCHAR(32),
	sector VARCHAR(32),
	enabled BOOLEAN NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_user_permissions PRIMARY KEY (id),
	CONSTRAINT uq_user_permissions_email UNIQUE (email)
)

;


CREATE TABLE IF NOT EXISTS data.workspace_config (
	id SMALLINT NOT NULL,
	revision INTEGER NOT NULL,
	budget_reasons JSON NOT NULL,
	budget_reason_version INTEGER NOT NULL,
	guide JSON NOT NULL,
	reference JSON NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_workspace_config PRIMARY KEY (id)
)

;


CREATE TABLE IF NOT EXISTS data.workspace_publications (
	id BIGSERIAL NOT NULL,
	budget_id BIGINT NOT NULL,
	department VARCHAR(32) NOT NULL,
	publication_number INTEGER NOT NULL,
	published_revision INTEGER NOT NULL,
	snapshot JSON NOT NULL,
	note TEXT,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_workspace_publications PRIMARY KEY (id)
)

;


CREATE TABLE IF NOT EXISTS data.workspace_references (
	id BIGSERIAL NOT NULL,
	planning_year SMALLINT NOT NULL,
	batch_id VARCHAR(128) NOT NULL,
	as_of VARCHAR(32) NOT NULL,
	dealer_id VARCHAR(255) NOT NULL,
	dealer_name VARCHAR(255),
	vol2024 NUMERIC(20, 4),
	c32024 NUMERIC(20, 4),
	vol2025 NUMERIC(20, 4),
	c32025 NUMERIC(20, 4),
	vol2026_ytd NUMERIC(20, 4),
	c32026_ytd NUMERIC(20, 4),
	mrd2025 NUMERIC(20, 4),
	spa2025 NUMERIC(20, 4),
	ice2025 NUMERIC(20, 4),
	capex2025 NUMERIC(20, 4),
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_workspace_references PRIMARY KEY (id)
)

;


-- Existing foundation tables keep all original rows.
ALTER TABLE data.budgets ADD COLUMN IF NOT EXISTS owner_email VARCHAR(255);
ALTER TABLE data.budgets ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE data.budgets_distributor ADD COLUMN IF NOT EXISTS budget_id BIGINT;
ALTER TABLE data.budgets_distributor ALTER COLUMN description TYPE VARCHAR(500);
ALTER TABLE data.budget_change_logs ALTER COLUMN operation_type TYPE VARCHAR(32);
ALTER TABLE data.budget_change_logs ALTER COLUMN operator_id TYPE VARCHAR(255);
ALTER TABLE data.budget_change_logs DROP CONSTRAINT IF EXISTS ck_budget_change_logs_operation_type;

-- Correct the old source business keys, which omitted resource_type.
ALTER TABLE data.budgets DROP CONSTRAINT IF EXISTS uq_budgets_business_key;
ALTER TABLE data.budgets ADD CONSTRAINT uq_budgets_business_key
  UNIQUE (planning_year, sector, department, resource_type, initiative_name);
ALTER TABLE data.budgets_distributor DROP CONSTRAINT IF EXISTS uq_distributor_budgets_business_key;
ALTER TABLE data.budgets_distributor ADD CONSTRAINT uq_distributor_budgets_business_key
  UNIQUE (planning_year, sector, department, resource_type, initiative_name, distributor_code);

-- Stop rather than silently hide old rows or associate them with an ambiguous budget.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM data.budgets_distributor d WHERE d.budget_id IS NULL
    AND (SELECT COUNT(*) FROM data.budgets b
      WHERE b.planning_year=d.planning_year AND b.sector=d.sector
      AND b.department=d.department AND b.resource_type=d.resource_type
      AND b.initiative_name=d.initiative_name) <> 1
  ) THEN
    RAISE EXCEPTION 'Unlinked distributor rows have missing or ambiguous budget keys. Reconcile before migration.';
  END IF;
END $$;
UPDATE data.budgets_distributor d SET budget_id=b.id FROM data.budgets b
WHERE d.budget_id IS NULL AND b.planning_year=d.planning_year AND b.sector=d.sector
  AND b.department=d.department AND b.resource_type=d.resource_type
  AND b.initiative_name=d.initiative_name;

INSERT INTO data.workspace_config
 (id,revision,budget_reasons,budget_reason_version,guide,reference)
 VALUES (1,0,
 '[{"id":"reserve","label":"新增经销商预留","enabled":true},{"id":"unallocated","label":"无法分配到经销商","enabled":true},{"id":"other","label":"其他支出","enabled":true}]',
 0,'{"version":1,"text":"仅依据同期间授权数据分析，不推断因果，不生成预测。"}','{}')
ON CONFLICT (id) DO NOTHING;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'uq_insight_prompt_year_scope'
                     AND conrelid = 'data.insight_prompts'::regclass) THEN
        ALTER TABLE data.insight_prompts ADD CONSTRAINT uq_insight_prompt_year_scope
            UNIQUE (planning_year, scope);
    END IF;
END $$;

COMMIT;

-- After reviewing real owners, maintain user_permissions and budgets.owner_email.
-- Existing historical_performance is preserved; the V1.4 reference API uses the typed
-- workspace_references table matching the supplied 2024/2025/2026-YTD source fields.
-- No history is silently converted or synthesized by this migration.
