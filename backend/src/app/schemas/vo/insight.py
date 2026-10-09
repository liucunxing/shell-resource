from typing import Any

from pydantic import BaseModel


class InsightPromptVO(BaseModel):
    scope: str
    text: str
    version: int
    editable: bool


class InsightReadVO(BaseModel):
    record: dict[str, Any] | None
    prompt: InsightPromptVO
    presets: list[dict[str, Any]] = []
    presetId: str = "comprehensive"
