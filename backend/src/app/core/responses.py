from typing import Generic, TypeVar

from pydantic import BaseModel

DataT = TypeVar("DataT")


class ApiResponse(BaseModel, Generic[DataT]):
    """Unified response contract returned to the frontend."""

    code: int = 200
    msg: str = "响应成功"
    data: DataT | None = None


def success(data: DataT | None = None, msg: str = "响应成功") -> ApiResponse[DataT]:
    return ApiResponse(code=200, msg=msg, data=data)

