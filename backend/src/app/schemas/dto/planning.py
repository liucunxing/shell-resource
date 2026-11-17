"""Planning version commands use explicit optimistic revisions."""

from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.dto.workbench import AdminBudgetCreateItemDTO


class PlanningVersionCreateDTO(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    id: str = Field(min_length=1, max_length=32, pattern=r"^20\d{2}(0[1-9]|1[0-2])$")
    name: str = Field(min_length=1, max_length=100)
    planning_year: int = Field(ge=2020, le=2100)
    source_version_id: str | None = Field(default=None, max_length=32)


class PlanningVersionUpdateDTO(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    expected_revision: int = Field(ge=0)
    id: str | None = Field(default=None, pattern=r"^20\d{2}(0[1-9]|1[0-2])$")
    name: str | None = Field(default=None, min_length=1, max_length=100)
    published: bool | None = None
    open: bool | None = None


class PlanningVersionReleaseDTO(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    expected_revision: int = Field(ge=0)
    reason: str = Field(min_length=1, max_length=160)



class PlanningVersionDeleteDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=0)
    confirm_submitted: bool = False


class DepartmentActionDTO(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    sector: str = Field(min_length=1, max_length=32)
    department: str = Field(min_length=1, max_length=32)
    expected_revision: int = Field(ge=0)
    reason: str = Field(default="", max_length=160)
    initiative_id: int | None = Field(default=None, gt=0)
    owner_email: str | None = Field(default=None, max_length=255)

    @model_validator(mode="after")
    def one_scope(self) -> "DepartmentActionDTO":
        if self.initiative_id and self.owner_email:
            raise ValueError("退回只可选择一个项目或一个 Owner")
        if self.owner_email:
            self.owner_email = self.owner_email.lower()
        return self


class VersionInitiativeDTO(AdminBudgetCreateItemDTO):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=0)
    reason: str = Field(min_length=1, max_length=160)
    enabled: bool = True

    @field_validator("budget")
    @classmethod
    def whole_currency_budget(cls, value: Decimal) -> Decimal:
        if value != value.to_integral_value():
            raise ValueError("规划预算必须为非负整数元")
        return value


class VersionInitiativeImportItemDTO(VersionInitiativeDTO):
    id: int | None = Field(default=None, gt=0)
    expected_revision: int = Field(default=0, ge=0)


class VersionInitiativesImportDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=0)
    items: list[VersionInitiativeImportItemDTO] = Field(min_length=1, max_length=5000)
    preview: bool = True

    @field_validator("items")
    @classmethod
    def unique_items(
        cls, items: list[VersionInitiativeImportItemDTO],
    ) -> list[VersionInitiativeImportItemDTO]:
        ids = [item.id for item in items if item.id is not None]
        keys = [(item.sector, item.department, item.resourceType, item.name) for item in items]
        if len(ids) != len(set(ids)) or len(keys) != len(set(keys)):
            raise ValueError("导入项目ID或业务键不可重复")
        return items
