from pydantic import RootModel


class TestTableValueVO(RootModel[int]):
    """Scalar value returned to the frontend from data.test_table."""
