from pydantic import BaseModel, Field


class InsightPromptUpdateDTO(BaseModel):
    scope: str = Field(min_length=1, max_length=300)
    planning_year: int = Field(ge=2000, le=2100)
    text: str = Field(min_length=1, max_length=12000)
    expected_version: int = Field(ge=0)


class InsightGenerateDTO(BaseModel):
    scope: str = Field(min_length=1, max_length=300)
    planning_year: int = Field(ge=2000, le=2100)
