from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


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


class InitiativeDraftUpdateDTO(BaseModel):
    expected_revision: int = Field(ge=0)
    rows: list[DraftRowDTO] = Field(default_factory=list)
    otherBudgets: list[OtherBudgetDTO] = Field(default_factory=list)


class PublishDTO(BaseModel):
    expected_revision: int = Field(ge=0)
    note: str = Field(default="", max_length=2000)


class AdminBudgetItemDTO(BaseModel):
    id: int = Field(gt=0)
    expected_revision: int = Field(ge=0)
    budget: Decimal = Field(ge=0, max_digits=18, decimal_places=2)
    ownerId: str = Field(min_length=3, max_length=255)


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


class AdminBudgetsCreateDTO(BaseModel):
    planning_year: int = Field(ge=2020, le=2100)
    items: list[AdminBudgetCreateItemDTO] = Field(min_length=1)


class AdminConfigDTO(BaseModel):
    expected_revision: int = Field(ge=0)
    budgetReasons: list[dict] | None = Field(default=None, min_length=1, max_length=30)
    guide: dict | None = None

    @field_validator("budgetReasons")
    @classmethod
    def validate_reasons(cls, reasons: list[dict] | None) -> list[dict] | None:
        if reasons is None:
            return reasons
        ids = set()
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
            ids.add(reason_id)
        return reasons

    @field_validator("guide")
    @classmethod
    def validate_guide(cls, guide: dict | None) -> dict | None:
        if guide is not None and (
            set(guide) - {"text", "version"} or not isinstance(guide.get("text"), str)
        ):
            raise ValueError("指南必须包含 text")
        return guide


class ReferenceDealerDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=255)
    name: str | None = Field(default=None, max_length=255)
    history: dict

    @field_validator("id")
    @classmethod
    def clean_id(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("经销商编码不能为空")
        return value.strip()

    @field_validator("history")
    @classmethod
    def validate_history(cls, history: dict) -> dict:
        allowed = {
            "vol2024",
            "c32024",
            "vol2025",
            "c32025",
            "vol2026Ytd",
            "c32026Ytd",
            "resources2025",
        }
        if set(history) - allowed:
            raise ValueError("历史数据包含未知或派生字段")
        result: dict[str, Any] = {}
        for key, value in history.items():
            if key == "resources2025":
                if not isinstance(value, dict) or set(value) - {
                    "MRD",
                    "SP&A",
                    "ICE Rebate",
                    "Capex",
                }:
                    raise ValueError("历史资源类型无效")
                result[key] = {name: cls.valid_number(number) for name, number in value.items()}
            else:
                result[key] = cls.valid_number(value)
        return result

    @staticmethod
    def valid_number(value: object) -> Decimal | None:
        if value is None:
            return None
        if isinstance(value, bool):
            raise ValueError("历史数字无效")
        try:
            number = Decimal(str(value))
        except Exception as exc:
            raise ValueError("历史数字无效") from exc
        if not number.is_finite() or number < 0 or number >= Decimal("10000000000000000"):
            raise ValueError("历史数字必须为有限非负数")
        return number


class ReferenceImportDTO(BaseModel):
    expected_revision: int = Field(ge=0)
    batchId: str = Field(min_length=1, max_length=128)
    asOf: str = Field(min_length=1, max_length=32)
    planning_year: int = Field(default=2027, ge=2020, le=2100)
    dealers: list[ReferenceDealerDTO] = Field(min_length=1)

    @field_validator("dealers")
    @classmethod
    def unique_dealers(cls, dealers: list[ReferenceDealerDTO]) -> list[ReferenceDealerDTO]:
        if len({dealer.id for dealer in dealers}) != len(dealers):
            raise ValueError("经销商编码不可重复")
        return dealers
