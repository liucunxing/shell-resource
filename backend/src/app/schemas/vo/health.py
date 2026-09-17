from typing import Literal

from pydantic import BaseModel


class HealthVO(BaseModel):
    status: Literal["ok"]
    service: str
    version: str
    environment: str

