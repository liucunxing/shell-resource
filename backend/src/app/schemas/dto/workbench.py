from decimal import Decimal

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

    @field_validator("description")
    @classmethod
    def normalize_description(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None
