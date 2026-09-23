from decimal import Decimal

from pydantic import BaseModel


class WorkbenchUserVO(BaseModel):
    user_id: str
    user_name: str
    department: str
    sector: str


class MyInitiativeVO(BaseModel):
    id: int
    planning_year: int
    sector: str
    department: str
    resource_type: str
    initiative: str
    budget: Decimal
    allocate_budget: Decimal
    status: int


class ResponsibleBudgetVO(BaseModel):
    planning_year: int
    initiative_count: int
    total_plan_budget_amount: Decimal


class CompletionProgressVO(BaseModel):
    total_initiative_count: int
    completed_initiative_count: int
    pending_initiative_count: int


class MyWorkbenchVO(BaseModel):
    current_user: WorkbenchUserVO
    initiatives: list[MyInitiativeVO]
    responsible_budget: ResponsibleBudgetVO
    completion_progress: CompletionProgressVO


class DistributorAllocationVO(BaseModel):
    id: int
    distributor_code: str
    allocate_amount: Decimal
    rate: Decimal
    desc: str | None


class InitiativeBudgetSummaryVO(BaseModel):
    budget_id: int
    initiative: str
    budget: Decimal
    allocated_amount: Decimal
    unexplained_difference: Decimal


class DistributorImportVO(BaseModel):
    imported_count: int
