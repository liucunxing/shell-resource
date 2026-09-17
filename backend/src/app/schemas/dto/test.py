from pydantic import BaseModel, Field


class EchoDTO(BaseModel):
    message: str = Field(min_length=1, max_length=200, description="需要原样返回的测试内容")

