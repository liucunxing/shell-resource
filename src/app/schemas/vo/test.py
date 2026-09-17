from datetime import datetime

from pydantic import BaseModel


class PingVO(BaseModel):
    message: str
    environment: str
    timestamp: datetime


class EchoVO(BaseModel):
    message: str

