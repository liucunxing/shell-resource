import re
from decimal import Decimal
from typing import Any, ClassVar, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.resource_access import AFFILIATION_DEPARTMENTS, RESOURCE_TYPES, SECTORS


class AdminUserDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sector_options: ClassVar[frozenset[str]] = frozenset({"PCMO", "CRTO", "B2B", "OEM"})

    email: str = Field(max_length=255)
    display_name: str = Field(max_length=255)
    role: Literal["owner", "lead", "management", "admin"]
    department: list[str] = Field(default_factory=list)
    sector: list[str] = Field(default_factory=list, max_length=4)
    enabled: bool = True
    affiliation_sector: str = Field(min_length=1, max_length=32)
    affiliation_department: str = Field(min_length=1, max_length=32)
    history_resources: list[str] | None = None

    @field_validator("affiliation_sector", "affiliation_department", mode="before")
    @classmethod
    def normalize_affiliation(cls, value: Any) -> Any:
        return value.strip().upper() if isinstance(value, str) else value

    @field_validator("affiliation_sector")
    @classmethod
    def valid_affiliation_sector(cls, value: str) -> str:
        if value not in SECTORS:
            raise ValueError("请选择有效的所属 Sector")
        return value

    @field_validator("affiliation_department")
    @classmethod
    def valid_affiliation_department(cls, value: str) -> str:
        if value not in AFFILIATION_DEPARTMENTS:
            raise ValueError("请选择有效的所属 Department")
        return value

    @field_validator("history_resources")
    @classmethod
    def valid_history_resources(cls, value: list[str] | None) -> list[str] | None:
        if value is not None and (
            len(value) != len(set(value)) or set(value) - set(RESOURCE_TYPES)
        ):
            raise ValueError("历史费用列无效或重复")
        return value

    @field_validator("email", "display_name", mode="before")
    @classmethod
    def strip_text(cls, value: Any) -> Any:
        return value.strip() if isinstance(value, str) else value

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: str) -> str:
        normalized = value.lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", normalized):
            raise ValueError("邮箱格式无效")
        return normalized

    @field_validator("display_name")
    @classmethod
    def valid_name(cls, value: str) -> str:
        if not value:
            raise ValueError("姓名不能为空")
        return value

    @field_validator("department", mode="before")
    @classmethod
    def normalize_department(cls, value: Any) -> Any:
        if value is None:
            return []
        if isinstance(value, str):
            value = [value] if value.strip() else []
        if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
            raise ValueError("部门必须为字符串列表")
        normalized = [item.strip().upper() for item in value]
        if any(not item or len(item) > 32 for item in normalized):
            raise ValueError("部门不能为空且最多 32 个字符")
        if len(normalized) != len(set(normalized)):
            raise ValueError("部门不可重复")
        return normalized

    @field_validator("sector", mode="before")
    @classmethod
    def normalize_sector(cls, value: Any) -> Any:
        if value is None:
            return []
        if not isinstance(value, list):
            raise ValueError("业务线必须为列表")
        if any(not isinstance(item, str) for item in value):
            raise ValueError("业务线必须为字符串")
        normalized = [item.strip().upper() for item in value]
        if len(normalized) != len(set(normalized)):
            raise ValueError("业务线不可重复")
        if any(item not in cls.sector_options for item in normalized):
            raise ValueError("业务线仅支持 PCMO、CRTO、B2B、OEM")
        return normalized

    @model_validator(mode="after")
    def valid_department(self) -> "AdminUserDTO":
        if self.role in {"owner", "lead"} and not self.department:
            raise ValueError("Owner 和部门负责人必须填写部门")
        if self.role in {"management", "admin"} and self.department:
            raise ValueError("管理层和管理员不填写部门")
        if self.role == "owner" and len(self.sector) != 1:
            raise ValueError("Owner 必须配置一条业务线")
        if self.role == "lead" and not 1 <= len(self.sector) <= 4:
            raise ValueError("部门负责人必须配置一至四条业务线")
        if self.role in {"management", "admin"} and self.sector:
            raise ValueError("管理层和管理员不配置业务线")
        return self


class UserInitiativeTransferDTO(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    budget_id: int = Field(gt=0)
    owner_email: str = Field(min_length=3, max_length=255)


class UserInitiativeAssignmentsDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version_id: str = Field(min_length=1, max_length=32)
    expected_revision: int = Field(ge=0)
    transfers: list[UserInitiativeTransferDTO] = Field(min_length=1, max_length=5000)

    @field_validator("transfers")
    @classmethod
    def unique_budgets(
        cls, value: list[UserInitiativeTransferDTO],
    ) -> list[UserInitiativeTransferDTO]:
        if len({item.budget_id for item in value}) != len(value):
            raise ValueError("项目不可重复")
        return value


class AdminUserUpdateDTO(AdminUserDTO):
    assignments: UserInitiativeAssignmentsDTO | None = None


class DistributorAllocationCreateDTO(BaseModel):
    distributor_code: str = Field(min_length=1, max_length=255)
    distributor_budget_amount: Decimal = Field(ge=0, max_digits=18, decimal_places=2)
    description: str | None = Field(default=None, max_length=255)

    @field_validator("distributor_code")
    @classmethod
    def normalize_distributor_code(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("经销商编码不能为空")
        return normalized

    @field_validator("description")
    @classmethod
    def normalize_description(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class DistributorAllocationUpdateDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")

    distributor_budget_amount: Decimal | None = Field(
        default=None,
        ge=0,
        max_digits=18,
        decimal_places=2,
    )
    description: str | None = Field(default=None, max_length=255)

    @field_validator("distributor_budget_amount")
    @classmethod
    def reject_null_amount(cls, value: Decimal | None) -> Decimal:
        if value is None:
            raise ValueError("分配金额不能为 null")
        return value

    @field_validator("description")
    @classmethod
    def normalize_description(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class DraftRowDTO(BaseModel):
    @field_validator("dealerId")
    @classmethod
    def clean_dealer_id(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("经销商编码不能为空")
        return value.strip()

    dealerId: str = Field(min_length=1, max_length=255)
    amount: Decimal = Field(ge=0, max_digits=18, decimal_places=2)
    note: str | None = Field(default=None, max_length=500)


class OtherBudgetDTO(BaseModel):
    id: int | str | None = None
    reasonId: str = Field(min_length=1, max_length=64)
    amount: Decimal = Field(ge=0, max_digits=18, decimal_places=2)
    note: str | None = Field(default=None, max_length=500)


class InitiativeTrialStateDTO(BaseModel):
    metric: Literal["vol", "c3", "investment"]
    period: Literal["2025", "2026Ytd"]
    baselineRows: list[DraftRowDTO]
    allocationFingerprint: str = Field(max_length=1048576)


class InitiativeEditorStateDTO(BaseModel):
    step: int = Field(default=1, ge=1, le=3, strict=True)
    reserveAcknowledgement: str = Field(default="", max_length=65536)
    trial: InitiativeTrialStateDTO | None = None


class InitiativeDraftUpdateDTO(BaseModel):
    expected_revision: int = Field(ge=0)
    rows: list[DraftRowDTO] = Field(default_factory=list)
    otherBudgets: list[OtherBudgetDTO] = Field(default_factory=list)
    changeReason: str = Field(default="", max_length=160)
    editorState: InitiativeEditorStateDTO | None = None


class PublishDTO(BaseModel):
    expected_revision: int = Field(ge=0)
    note: str = Field(default="", max_length=2000)


class AdminBudgetItemDTO(BaseModel):
    id: int = Field(gt=0)
    expected_revision: int = Field(ge=0)
    budget: Decimal = Field(ge=0, max_digits=18, decimal_places=2)
    ownerId: str = Field(min_length=3, max_length=255)

    @field_validator("ownerId", mode="before")
    @classmethod
    def normalize_owner(cls, value: Any) -> Any:
        return value.strip().lower() if isinstance(value, str) else value


class AdminBudgetsUpdateDTO(BaseModel):
    items: list[AdminBudgetItemDTO] = Field(min_length=1)

    @field_validator("items")
    @classmethod
    def unique_ids(cls, items: list[AdminBudgetItemDTO]) -> list[AdminBudgetItemDTO]:
        if len({item.id for item in items}) != len(items):
            raise ValueError("预算 ID 不可重复")
        return items


class AdminBudgetCreateItemDTO(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    resourceType: str = Field(min_length=1, max_length=64)
    sector: str = Field(min_length=1, max_length=32)
    department: str = Field(min_length=1, max_length=32)
    budget: Decimal = Field(ge=0, max_digits=18, decimal_places=2)
    ownerId: str = Field(min_length=3, max_length=255)

    @field_validator("name", "resourceType", "sector", "department", "ownerId", mode="before")
    @classmethod
    def normalize_text(cls, value: Any) -> Any:
        return value.strip() if isinstance(value, str) else value

    @field_validator("ownerId")
    @classmethod
    def normalize_owner(cls, value: str) -> str:
        return value.lower()

    @field_validator("resourceType")
    @classmethod
    def normalize_resource_type(cls, value: str) -> str:
        resources = {name.lower(): name for name in ("MRD", "SP&A", "ICE Rebate", "Capex")}
        return resources.get(value.lower(), value)


class AdminBudgetEditDTO(AdminBudgetCreateItemDTO):
    expected_revision: int = Field(ge=0)


class AdminBudgetDeleteDTO(BaseModel):
    expected_revision: int = Field(ge=0)


class AdminBudgetsCreateDTO(BaseModel):
    planning_year: int = Field(ge=2020, le=2100)
    items: list[AdminBudgetCreateItemDTO] = Field(min_length=1)


class AdminBudgetsImportDTO(BaseModel):
    planning_year: int = Field(ge=2020, le=2100)
    updates: list[AdminBudgetItemDTO] = Field(default_factory=list, max_length=5000)
    creates: list[AdminBudgetCreateItemDTO] = Field(default_factory=list, max_length=5000)

    @field_validator("updates")
    @classmethod
    def unique_update_ids(cls, items: list[AdminBudgetItemDTO]) -> list[AdminBudgetItemDTO]:
        if len({item.id for item in items}) != len(items):
            raise ValueError("预算 ID 不可重复")
        return items

    @model_validator(mode="after")
    def has_changes(self) -> "AdminBudgetsImportDTO":
        if not self.updates and not self.creates:
            raise ValueError("导入内容没有新增或修改")
        if len(self.updates) + len(self.creates) > 5000:
            raise ValueError("导入配置总行数不能超过 5000")
        return self


class AdminUsersImportDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: str = Field(min_length=64, max_length=64)
    items: list[AdminUserDTO] = Field(min_length=1, max_length=5000)
    preview: bool = True

    @field_validator("items")
    @classmethod
    def unique_emails(cls, items: list[AdminUserDTO]) -> list[AdminUserDTO]:
        if len({item.email for item in items}) != len(items):
            raise ValueError("导入邮箱不可重复")
        return items


class AdminConfigDTO(BaseModel):
    legendColors: dict[str, dict[str, str]] | None = None

    @field_validator("legendColors")
    @classmethod
    def validate_legend_colors(cls, value: dict | None) -> dict | None:
        if value is None:
            return None
        if set(value) - {"initiatives", "resources", "departments"}:
            raise ValueError("颜色图例分类无效")
        for entries in value.values():
            if len(entries) > 5000:
                raise ValueError("颜色图例数量超限")
            for key, color in entries.items():
                if not key.strip() or len(key) > 255 or not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
                    raise ValueError("颜色须为 #RRGGBB，图例名称不能为空")
        return {
            kind: {key: color.upper() for key, color in entries.items()}
            for kind, entries in value.items()
        }

    expected_revision: int = Field(ge=0)
    budgetReasons: list[dict] | None = Field(default=None, min_length=1, max_length=30)
    guide: dict | None = None
    departmentResources: dict[str, list[str]] | None = None
    roleResources: dict[str, list[str]] | None = None
    healthThresholds: dict[str, float] | None = None
    ytdCutoffMonth: int | None = Field(default=None, ge=1, le=12, strict=True)
    historyInvestmentExchangeRate: float | None = Field(
        default=None, gt=0, allow_inf_nan=False, strict=True,
    )

    @field_validator("healthThresholds")
    @classmethod
    def validate_health_thresholds(cls, value: dict | None) -> dict | None:
        if value is None:
            return None
        keys = {"concentrationYellow", "concentrationRed", "dealerYellow", "dealerRed"}
        if set(value) != keys:
            raise ValueError("健康度阈值必须包含集中度和经销商的黄色、红色阈值")
        for prefix in ("concentration", "dealer"):
            if not 0 <= value[prefix + "Yellow"] < value[prefix + "Red"] <= 100:
                raise ValueError("健康度阈值必须满足 0 ≤ 黄色 < 红色 ≤ 100")
        return value

    @field_validator("roleResources")
    @classmethod
    def validate_role_resources(cls, value: dict | None) -> dict | None:
        if value is None:
            return None
        if set(value) - {"owner", "lead", "management", "admin"}:
            raise ValueError("历史费用角色无效")
        for resources in value.values():
            if len(resources) != len(set(resources)) or set(resources) - set(RESOURCE_TYPES):
                raise ValueError("历史费用列无效或重复")
        return value

    @field_validator("departmentResources")
    @classmethod
    def validate_department_resources(cls, value: dict | None) -> dict | None:
        if value is None:
            return None
        normalized = {}
        for department, resources in value.items():
            name = department.strip().upper()
            parts = name.split("|")
            valid = (len(parts) == 1 and parts[0] in AFFILIATION_DEPARTMENTS) or (
                len(parts) == 2 and parts[0] in SECTORS and parts[1] in AFFILIATION_DEPARTMENTS
            )
            if not valid or name in normalized:
                raise ValueError("部门名称无效或重复")
            if len(resources) != len(set(resources)) or set(resources) - set(RESOURCE_TYPES):
                raise ValueError("历史资源类型无效或重复")
            normalized[name] = resources
        return normalized

    @field_validator("budgetReasons")
    @classmethod
    def validate_reasons(cls, reasons: list[dict] | None) -> list[dict] | None:
        if reasons is None:
            return reasons
        ids = set()
        labels = set()
        for reason in reasons:
            if set(reason) - {"id", "label", "enabled"}:
                raise ValueError("预算原因包含未知字段")
            reason_id = reason.get("id")
            label = reason.get("label")
            if not isinstance(reason_id, str) or not reason_id.strip() or len(reason_id) > 64:
                raise ValueError("预算原因 ID 无效")
            if reason_id[0] not in "abcdefghijklmnopqrstuvwxyz" or any(
                char not in "abcdefghijklmnopqrstuvwxyz0123456789_-" for char in reason_id
            ):
                raise ValueError("预算原因 ID 格式无效")
            if reason_id in ids:
                raise ValueError("预算原因 ID 不可重复")
            if not isinstance(label, str) or not label.strip() or len(label.strip()) > 80:
                raise ValueError("预算原因名称无效")
            if not isinstance(reason.get("enabled"), bool):
                raise ValueError("预算原因 enabled 必须为布尔值")
            normalized_label = label.strip()
            if normalized_label in labels:
                raise ValueError("预算原因名称不可重复")
            labels.add(normalized_label)
            reason["label"] = normalized_label
            ids.add(reason_id)
        if not any(reason["enabled"] for reason in reasons):
            raise ValueError("至少保留一个启用的预留原因")
        return reasons

    @field_validator("guide")
    @classmethod
    def validate_guide(cls, guide: dict | None) -> dict | None:
        if guide is not None and (
            set(guide) - {"text", "version"} or not isinstance(guide.get("text"), str)
        ):
            raise ValueError("指南必须包含 text")
        return guide
