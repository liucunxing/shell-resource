import asyncio
from decimal import Decimal
from io import BytesIO
from zipfile import ZipFile

import pytest
from fastapi import HTTPException, UploadFile

from app.models.do.budget_distributor import BudgetDistributorDO
from app.services.workbench_service import WorkbenchService


def _xlsx_with_rows(rows: list[list[str]]) -> bytes:
    xml_rows: list[str] = []
    for row_number, values in enumerate(rows, start=1):
        cells: list[str] = []
        for column_index, value in enumerate(values):
            column_name = chr(ord("A") + column_index)
            cells.append(
                f'<c r="{column_name}{row_number}" t="inlineStr"><is><t>{value}</t></is></c>'
            )
        xml_rows.append(f'<row r="{row_number}">{"".join(cells)}</row>')
    worksheet = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<sheetData>{"".join(xml_rows)}</sheetData></worksheet>'
    )
    output = BytesIO()
    with ZipFile(output, "w") as archive:
        archive.writestr("xl/worksheets/sheet1.xml", worksheet)
    return output.getvalue()


def test_import_parser_accepts_template_headers() -> None:
    content = _xlsx_with_rows(
        [
            ["distributor_code", "allocate_amount", "desc"],
            ["D001", "1250.50", "首轮分配"],
        ]
    )
    upload = UploadFile(filename="allocation.xlsx", file=BytesIO(content))

    rows = asyncio.run(WorkbenchService._parse_import_file(upload, 1024 * 1024))

    assert len(rows) == 1
    assert rows[0].distributor_code == "D001"
    assert rows[0].distributor_budget_amount == Decimal("1250.50")
    assert rows[0].description == "首轮分配"


def test_import_parser_rejects_duplicate_distributor_codes() -> None:
    content = _xlsx_with_rows(
        [
            ["经销商编码", "分配金额", "说明"],
            ["D001", "100", "第一行"],
            ["D001", "200", "重复行"],
        ]
    )
    upload = UploadFile(filename="allocation.xlsx", file=BytesIO(content))

    with pytest.raises(HTTPException, match="经销商编码重复"):
        asyncio.run(WorkbenchService._parse_import_file(upload, 1024 * 1024))


def test_allocation_rate_uses_initiative_plan_budget() -> None:
    allocation = BudgetDistributorDO(
        id=1,
        planning_year=2027,
        sector="PCMO",
        department="MKT",
        resource_type="Trade",
        initiative_name="Initiative A",
        distributor_code="D001",
        distributor_budget_amount=Decimal("25.00"),
        input_source="MANUAL",
        description=None,
    )

    result = WorkbenchService._allocation_vo(allocation, Decimal("100.00"))

    assert result.rate == Decimal("0.2500")
