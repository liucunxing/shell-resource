-- Data preparation V1: initial PostgreSQL DDL.
-- Scope: budget maintenance, historical performance import, and budget audit logs.
-- This script is a reviewable DDL draft. Do not apply it to production until
-- the business grain and retention policy have been confirmed.

CREATE SCHEMA IF NOT EXISTS data;
--新年2027预算表DDL
CREATE TABLE IF NOT EXISTS data.budgets (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    planning_year SMALLINT NOT NULL,
    sector VARCHAR(32) NOT NULL,
    department VARCHAR(32) NOT NULL,
    resource_type VARCHAR(64) NOT NULL,
    initiative_name VARCHAR(255) NOT NULL,
    plan_budget_amount NUMERIC(18, 2) NOT NULL,
    allocate_budget_amount NUMERIC(18, 2) NOT NULL,
    status int NOT NULL,
    input_source VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_budgets_plan_budget_amount
        CHECK (plan_budget_amount >= 0),
    CONSTRAINT uq_budgets_business_key
        UNIQUE (planning_year, sector, department, initiative_name)
);

COMMENT ON TABLE data.budgets IS '总预算内容，管理员导入';
COMMENT ON COLUMN data.budgets.planning_year IS '规划年度；当前原型未展示，后续由页面上下文或接口参数提供。';
COMMENT ON COLUMN data.budgets.input_source IS '数据来源：MANUAL 或 EXCEL_IMPORT。';
COMMENT ON COLUMN data.budgets.status IS '0-编辑中 1-已完成';

CREATE INDEX IF NOT EXISTS ix_budgets_planning_year_department
    ON data.budgets (planning_year, department);

--经销商分配的预算
CREATE TABLE IF NOT EXISTS data.budgets_distributor (
                                            id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                                            planning_year SMALLINT NOT NULL,
                                            sector VARCHAR(32) NOT NULL,
                                            department VARCHAR(32) NOT NULL,
                                            resource_type VARCHAR(64) NOT NULL,
                                            initiative_name VARCHAR(255) NOT NULL,
                                            distributor_code VARCHAR(255) NOT NULL,
                                            distributor_budget_amount NUMERIC(18, 2) NOT NULL,
                                            input_source VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
                                            description VARCHAR(255),
                                            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                            updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                            CONSTRAINT ck_distributor_budgets_plan_budget_amount
                                                CHECK (distributor_budget_amount >= 0),
                                            CONSTRAINT uq_distributor_budgets_business_key
                                                UNIQUE (planning_year, sector, department, initiative_name, distributor_code)
);

COMMENT ON TABLE data.budgets_distributor IS '总预算分配内容，到经销商粒度, 页面或excel用户导入';
COMMENT ON COLUMN data.budgets_distributor.planning_year IS '规划年度';
COMMENT ON COLUMN data.budgets_distributor.input_source IS '数据来源：MANUAL 或 EXCEL_IMPORT。';

--历史表现表DDL 历史投资/vol/c3
CREATE TABLE IF NOT EXISTS data.historical_performance (
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
        UNIQUE (
            history_year,
            period_code,
            sector,
            distributor_name,
            resource_type
        )
);

COMMENT ON TABLE data.historical_performance IS '数据准备页：Distributor 历史 Vol、C3、Resource 数据。';
COMMENT ON COLUMN data.historical_performance.period_code IS '原型中的 Quarter/期间标识，不限制具体编码。';
COMMENT ON COLUMN data.historical_performance.resource_amount IS '原型中的 Resource 数值字段。';

CREATE INDEX IF NOT EXISTS ix_historical_performance_lookup
    ON data.historical_performance (
        history_year,
        period_code,
        sector,
        distributor_name
    );

--对预算表的日志记录表DDL
CREATE TABLE IF NOT EXISTS data.budget_change_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    budget_id BIGINT NOT NULL,
    operation_type VARCHAR(10) NOT NULL,
    before_data JSONB,
    after_data JSONB,
    operator_id VARCHAR(128),
    operator_name VARCHAR(255),
    request_id VARCHAR(128),
    operation_note TEXT,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_budget_change_logs_operation_type
        CHECK (operation_type IN ('INSERT', 'UPDATE', 'DELETE'))
);

COMMENT ON TABLE data.budget_change_logs IS '预算新增、修改、删除的不可变审计日志。';
COMMENT ON COLUMN data.budget_change_logs.budget_id IS '保留原预算 ID，不建外键，保证预算物理删除后仍能追溯日志。';

CREATE INDEX IF NOT EXISTS ix_budget_change_logs_budget_changed_at
    ON data.budget_change_logs (budget_id, changed_at DESC);


