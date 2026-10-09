-- Complete PostgreSQL schema for a fresh V1.4 workbench database.
-- Run once after the old data.* tables have been dropped. This is not an
-- incremental migration and contains no users or sample business data.
BEGIN;

CREATE SCHEMA IF NOT EXISTS data;

-- Initiative budgets. Owner is assigned by email from data.user_permissions.
CREATE TABLE data.budgets (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    planning_year SMALLINT NOT NULL,
    sector VARCHAR(32) NOT NULL,
    department VARCHAR(32) NOT NULL,
    resource_type VARCHAR(64) NOT NULL,
    initiative_name VARCHAR(255) NOT NULL,
    plan_budget_amount NUMERIC(18, 2) NOT NULL,
    allocate_budget_amount NUMERIC(18, 2) NOT NULL,
    owner_email VARCHAR(255),
    revision INTEGER NOT NULL DEFAULT 0,
    status INTEGER NOT NULL,
    input_source VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_budgets_plan_budget_amount CHECK (plan_budget_amount >= 0),
    CONSTRAINT uq_budgets_business_key UNIQUE (
        planning_year, sector, department, resource_type, initiative_name
    )
);

COMMENT ON TABLE data.budgets IS 'Initiative 预算及其执行负责人';
COMMENT ON COLUMN data.budgets.status IS '0-编辑中 1-已完成';
COMMENT ON COLUMN data.budgets.owner_email IS '负责该 Initiative 的已启用 Owner 邮箱';

CREATE INDEX ix_budgets_planning_year_department
    ON data.budgets (planning_year, department);
CREATE INDEX ix_budgets_owner_email
    ON data.budgets (owner_email);

-- Distributor allocations are linked to one Initiative by budget_id.
CREATE TABLE data.budgets_distributor (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    budget_id BIGINT,
    planning_year SMALLINT NOT NULL,
    sector VARCHAR(32) NOT NULL,
    department VARCHAR(32) NOT NULL,
    resource_type VARCHAR(64) NOT NULL,
    initiative_name VARCHAR(255) NOT NULL,
    distributor_code VARCHAR(255) NOT NULL,
    distributor_budget_amount NUMERIC(18, 2) NOT NULL,
    input_source VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
    description VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_distributor_budgets_plan_budget_amount
        CHECK (distributor_budget_amount >= 0),
    CONSTRAINT uq_distributor_budgets_business_key UNIQUE (
        planning_year, sector, department, resource_type,
        initiative_name, distributor_code
    )
);

COMMENT ON TABLE data.budgets_distributor IS '按 Distributor 分配的 Initiative 预算';
CREATE INDEX ix_budgets_distributor_budget_id
    ON data.budgets_distributor (budget_id);

-- Historical source loaded by the data team and read directly by the V1.4 workbench.
CREATE TABLE data.distributor_sellin_resource_history (
    distributor_code VARCHAR(255),
    distributor_name VARCHAR(255),
    volume_2024 NUMERIC(10, 2),
    c3_2024 NUMERIC(10, 2),
    volume_2025 NUMERIC(10, 2),
    c3_2025 NUMERIC(10, 2),
    volume_2026 NUMERIC(10, 2),
    c3_2026 NUMERIC(10, 2),
    mrd_2025 NUMERIC(10, 2),
    reb_2025 NUMERIC(10, 2),
    btl_2025 NUMERIC(10, 2),
    capex_2025 NUMERIC(10, 2),
    yield_2025 NUMERIC(10, 2),
    sector VARCHAR(100)
);

COMMENT ON TABLE data.distributor_sellin_resource_history IS
    '经销商历史 Vol、C3、资源和 Yield 数据；Yield 为原始比值，不是百分比';

-- Legacy data-preparation history remains available for compatibility.
CREATE TABLE data.historical_performance (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    history_year SMALLINT NOT NULL,
    period_code VARCHAR(32) NOT NULL,
    sector VARCHAR(32) NOT NULL,
    distributor_name VARCHAR(255) NOT NULL,
    resource_type VARCHAR(64) NOT NULL,
    volume NUMERIC(20, 4) NOT NULL DEFAULT 0,
    c3 NUMERIC(20, 4) NOT NULL DEFAULT 0,
    resource_amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
    source_file_name VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_historical_performance_business_key UNIQUE (
        history_year, period_code, sector, distributor_name, resource_type
    )
);

COMMENT ON TABLE data.historical_performance IS 'Distributor 历史 Vol、C3、Resource 数据';
COMMENT ON COLUMN data.historical_performance.period_code IS '全年或季度期间标识';
CREATE INDEX ix_historical_performance_lookup
    ON data.historical_performance (history_year, period_code, sector, distributor_name);

-- Budget, draft, configuration and reference audit records.
CREATE TABLE data.budget_change_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    budget_id BIGINT NOT NULL,
    operation_type VARCHAR(32) NOT NULL,
    before_data JSON,
    after_data JSON,
    operator_id VARCHAR(255),
    operator_name VARCHAR(255),
    request_id VARCHAR(128),
    operation_note TEXT,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE data.budget_change_logs IS '预算和工作台操作审计日志';
COMMENT ON COLUMN data.budget_change_logs.budget_id IS '配置操作可使用 0；不建外键以保留历史日志';
CREATE INDEX ix_budget_change_logs_budget_changed_at
    ON data.budget_change_logs (budget_id, changed_at DESC);

CREATE TABLE data.user_permissions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL,
    department VARCHAR(32),
    sector VARCHAR(32)[],
    enabled BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_user_permissions_email UNIQUE (email),
    CONSTRAINT ck_user_permissions_role_sector_count CHECK (
        COALESCE(
            CASE role
                WHEN 'owner' THEN cardinality(sector) = 1
                WHEN 'lead' THEN cardinality(sector) BETWEEN 1 AND 4
                WHEN 'management' THEN COALESCE(cardinality(sector), 0) = 0
                WHEN 'admin' THEN COALESCE(cardinality(sector), 0) = 0
                ELSE FALSE
            END,
            FALSE
        )
    )
);

-- Rows not attributed to a Distributor.
CREATE TABLE data.other_budgets (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    budget_id BIGINT NOT NULL,
    reason_id VARCHAR(64) NOT NULL,
    amount NUMERIC(18, 2) NOT NULL,
    note VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX ix_other_budgets_budget_id ON data.other_budgets (budget_id);

CREATE TABLE data.workspace_config (
    id SMALLINT PRIMARY KEY,
    revision INTEGER NOT NULL,
    budget_reasons JSON NOT NULL,
    budget_reason_version INTEGER NOT NULL,
    guide JSON NOT NULL,
    reference JSON NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO data.workspace_config
    (id, revision, budget_reasons, budget_reason_version, guide, reference)
VALUES (
    1,
    0,
    '[{"id":"reserve","label":"新增经销商预留","enabled":true},
      {"id":"unallocated","label":"无法分配到经销商","enabled":true},
      {"id":"other","label":"其他支出","enabled":true}]',
    0,
    '{"version":1,"text":"仅依据同期间授权数据分析，不推断因果，不生成预测。"}',
    '{}'
);

CREATE TABLE data.workspace_publications (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    budget_id BIGINT NOT NULL,
    department VARCHAR(32) NOT NULL,
    publication_number INTEGER NOT NULL,
    published_revision INTEGER NOT NULL,
    snapshot JSON NOT NULL,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX ix_workspace_publications_budget_id
    ON data.workspace_publications (budget_id);

-- Legacy admin-import storage retained for API compatibility. It is not the
-- V1.4 workbench's active historical-data source.
CREATE TABLE data.workspace_references (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX ix_workspace_references_planning_year
    ON data.workspace_references (planning_year);

CREATE TABLE data.insight_prompts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    planning_year SMALLINT NOT NULL,
    scope VARCHAR(300) NOT NULL,
    text TEXT NOT NULL,
    version INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_insight_prompt_year_scope UNIQUE (planning_year, scope)
);

CREATE TABLE data.insight_records (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    planning_year SMALLINT NOT NULL,
    scope VARCHAR(300) NOT NULL,
    signature VARCHAR(80) NOT NULL,
    prompt_version INTEGER NOT NULL,
    reference_batch_id VARCHAR(128),
    guide_version INTEGER NOT NULL,
    created_by_email VARCHAR(255) NOT NULL,
    record JSON NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMIT;
