from collections.abc import Iterable
from decimal import ROUND_HALF_UP, Decimal
from io import BytesIO
from xml.etree import ElementTree
from zipfile import BadZipFile, ZipFile

from fastapi import HTTPException, UploadFile, status
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError

from app.core.config import Settings
from app.dependencies.workbench_user import WorkbenchUser
from app.models.do.budget import BudgetDO
from app.models.do.budget_distributor import BudgetDistributorDO
from app.repositories.budget_repository import BudgetDistributorRepository, BudgetRepository
from app.schemas.dto.workbench import (
    DistributorAllocationCreateDTO,
    DistributorAllocationUpdateDTO,
)
from app.schemas.vo.workbench import (
    CompletionProgressVO,
    DistributorAllocationVO,
    DistributorImportVO,
    InitiativeBudgetSummaryVO,
    MyInitiativeVO,
    MyWorkbenchVO,
    ResponsibleBudgetVO,
    WorkbenchUserVO,
)
from app.storage.azure_blob import AzureBlobStorage, BlobNotFoundError, BlobStorageError

WORKBENCH_PLANNING_YEAR = 2027
RATE_SCALE = Decimal("0.0001")
SPREADSHEET_NAMESPACE = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


class WorkbenchService:
    """Business operations exposed by the temporary MKT/PCMO workbench."""

    def __init__(
        self,
        budget_repository: BudgetRepository,
        distributor_repository: BudgetDistributorRepository,
        user: WorkbenchUser,
    ) -> None:
        self.budget_repository = budget_repository
        self.distributor_repository = distributor_repository
        self.user = user

    async def get_my_workbench(
        self,
        *,
        initiative_keyword: str | None,
        resource_type_keyword: str | None,
        status_value: int | None,
    ) -> MyWorkbenchVO:
        initiatives = await self.budget_repository.list_for_workbench(
            planning_year=WORKBENCH_PLANNING_YEAR,
            department=self.user.department,
            sector=self.user.sector,
            initiative_keyword=initiative_keyword,
            resource_type_keyword=resource_type_keyword,
            status=status_value,
        )
        total_count, total_budget, completed_count = (
            await self.budget_repository.get_dashboard_totals(
                planning_year=WORKBENCH_PLANNING_YEAR,
                department=self.user.department,
                sector=self.user.sector,
            )
        )
        return MyWorkbenchVO(
            current_user=WorkbenchUserVO(
                user_id=self.user.user_id,
                user_name=self.user.user_name,
                department=self.user.department,
                sector=self.user.sector,
            ),
            initiatives=[self._initiative_vo(item) for item in initiatives],
            responsible_budget=ResponsibleBudgetVO(
                planning_year=WORKBENCH_PLANNING_YEAR,
                initiative_count=total_count,
                total_plan_budget_amount=total_budget,
            ),
            completion_progress=CompletionProgressVO(
                total_initiative_count=total_count,
                completed_initiative_count=completed_count,
                pending_initiative_count=total_count - completed_count,
            ),
        )

    async def list_distributor_allocations(
        self,
        budget_id: int,
    ) -> list[DistributorAllocationVO]:
        budget = await self._get_scoped_budget(budget_id)
        rows = await self.distributor_repository.list_for_budget(budget)
        return [self._allocation_vo(row, budget.plan_budget_amount) for row in rows]

    async def get_budget_summary(self, budget_id: int) -> InitiativeBudgetSummaryVO:
        budget = await self._get_scoped_budget(budget_id)
        allocated_amount = await self.distributor_repository.get_total_for_budget(budget)
        return InitiativeBudgetSummaryVO(
            budget_id=budget.id,
            initiative=budget.initiative_name,
            budget=budget.plan_budget_amount,
            allocated_amount=allocated_amount,
            unexplained_difference=budget.plan_budget_amount - allocated_amount,
        )

    async def create_distributor_allocation(
        self,
        *,
        budget_id: int,
        payload: DistributorAllocationCreateDTO,
    ) -> DistributorAllocationVO:
        try:
            async with self.budget_repository.session.begin():
                budget = await self._get_scoped_budget(budget_id)
                row = await self.distributor_repository.add_for_budget(
                    budget=budget,
                    distributor_code=payload.distributor_code,
                    distributor_budget_amount=payload.distributor_budget_amount,
                    description=payload.description,
                )
        except IntegrityError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="该 Initiative 下的经销商预算已存在",
            ) from exc
        return self._allocation_vo(row, budget.plan_budget_amount)

    async def update_distributor_allocation(
        self,
        *,
        budget_id: int,
        allocation_id: int,
        payload: DistributorAllocationUpdateDTO,
    ) -> DistributorAllocationVO:
        updates = payload.model_dump(exclude_unset=True)
        if not updates:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="至少需要提供一个待修改字段",
            )
        async with self.budget_repository.session.begin():
            budget = await self._get_scoped_budget(budget_id)
            row = await self.distributor_repository.get_for_budget(budget, allocation_id)
            if row is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="经销商预算记录不存在或不属于当前 Initiative",
                )
            for field_name, value in updates.items():
                setattr(row, field_name, value)
            await self.budget_repository.session.flush()
        return self._allocation_vo(row, budget.plan_budget_amount)

    async def delete_distributor_allocation(self, *, budget_id: int, allocation_id: int) -> None:
        async with self.budget_repository.session.begin():
            budget = await self._get_scoped_budget(budget_id)
            row = await self.distributor_repository.get_for_budget(budget, allocation_id)
            if row is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="经销商预算记录不存在或不属于当前 Initiative",
                )
            await self.budget_repository.session.delete(row)

    async def import_distributor_allocations(
        self,
        *,
        budget_id: int,
        file: UploadFile,
        max_upload_bytes: int,
    ) -> DistributorImportVO:
        rows = await self._parse_import_file(file, max_upload_bytes)
        try:
            async with self.budget_repository.session.begin():
                budget = await self._get_scoped_budget(budget_id)
                for row in rows:
                    await self.distributor_repository.add_for_budget(
                        budget=budget,
                        distributor_code=row.distributor_code,
                        distributor_budget_amount=row.distributor_budget_amount,
                        description=row.description,
                    )
        except IntegrityError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="导入失败：存在已录入的经销商编码，未写入任何数据",
            ) from exc
        return DistributorImportVO(imported_count=len(rows))

    @staticmethod
    async def download_import_template(
        *,
        storage: AzureBlobStorage,
        settings: Settings,
    ) -> tuple[str, bytes, str]:
        blob_name = (settings.azure_blob_workbench_template_name or "").strip()
        if not blob_name:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="经销商分配模板尚未配置到 Azure Blob",
            )
        try:
            result = await storage.download(blob_name=blob_name)
        except BlobNotFoundError as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Azure Blob 中不存在经销商分配模板",
            ) from exc
        except BlobStorageError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="下载经销商分配模板失败",
            ) from exc
        return result.blob_name, result.data, result.content_type

    async def _get_scoped_budget(self, budget_id: int) -> BudgetDO:
        budget = await self.budget_repository.get_scoped(
            budget_id=budget_id,
            planning_year=WORKBENCH_PLANNING_YEAR,
            department=self.user.department,
            sector=self.user.sector,
        )
        if budget is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="预算不存在或不属于当前工作台范围",
            )
        return budget

    @staticmethod
    def _initiative_vo(item: BudgetDO) -> MyInitiativeVO:
        return MyInitiativeVO(
            id=item.id,
            planning_year=item.planning_year,
            sector=item.sector,
            department=item.department,
            resource_type=item.resource_type,
            initiative=item.initiative_name,
            budget=item.plan_budget_amount,
            allocate_budget=item.allocate_budget_amount,
            status=item.status,
        )

    @staticmethod
    def _allocation_vo(
        item: BudgetDistributorDO,
        plan_budget_amount: Decimal,
    ) -> DistributorAllocationVO:
        allocation_rate = Decimal("0")
        if plan_budget_amount:
            allocation_rate = (item.distributor_budget_amount / plan_budget_amount).quantize(
                RATE_SCALE,
                rounding=ROUND_HALF_UP,
            )
        return DistributorAllocationVO(
            id=item.id,
            distributor_code=item.distributor_code,
            allocate_amount=item.distributor_budget_amount,
            rate=allocation_rate,
            desc=item.description,
        )

    @staticmethod
    async def _parse_import_file(
        file: UploadFile,
        max_upload_bytes: int,
    ) -> list[DistributorAllocationCreateDTO]:
        filename = (file.filename or "").strip()
        if not filename.lower().endswith(".xlsx"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="仅支持 .xlsx 格式的经销商分配模板",
            )
        content = await file.read(max_upload_bytes + 1)
        if not content:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="导入文件不能为空",
            )
        if len(content) > max_upload_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail=f"导入文件不能超过 {max_upload_bytes} 字节",
            )
        try:
            rows = WorkbenchService._read_xlsx_rows(content)
        except (BadZipFile, ElementTree.ParseError, KeyError, OSError, ValueError) as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="导入文件不是有效的 .xlsx 工作簿",
            ) from exc
        if not rows:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="导入文件缺少表头和数据",
            )

        headers = WorkbenchService._header_indexes(rows[0])
        parsed_rows: list[DistributorAllocationCreateDTO] = []
        errors: list[str] = []
        for row_number, values in enumerate(rows[1:], start=2):
            if WorkbenchService._is_blank_row(values):
                continue
            record = {
                "distributor_code": WorkbenchService._cell_value(
                    values, headers["distributor_code"]
                ),
                "distributor_budget_amount": WorkbenchService._cell_value(
                    values, headers["distributor_budget_amount"]
                ),
                "description": WorkbenchService._cell_value(values, headers["description"]),
            }
            try:
                parsed_rows.append(DistributorAllocationCreateDTO.model_validate(record))
            except ValidationError as exc:
                errors.append(f"第 {row_number} 行：{exc.errors()[0]['msg']}")

        if not parsed_rows and not errors:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="导入文件没有经销商分配数据",
            )
        duplicate_codes = WorkbenchService._duplicate_codes(parsed_rows)
        if duplicate_codes:
            errors.append(f"经销商编码重复：{', '.join(duplicate_codes)}")
        if errors:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="导入文件校验失败：" + "；".join(errors[:20]),
            )
        return parsed_rows

    @staticmethod
    def _header_indexes(header_row: tuple[object, ...]) -> dict[str, int]:
        normalized = {
            str(value).strip().lower(): index
            for index, value in enumerate(header_row)
            if value is not None and str(value).strip()
        }
        aliases = {
            "distributor_code": ("distributor_code", "经销商编码"),
            "distributor_budget_amount": (
                "distributor_budget_amount",
                "allocate_amount",
                "分配金额",
            ),
            "description": ("description", "desc", "说明"),
        }
        indexes: dict[str, int] = {}
        missing: list[str] = []
        for field_name, field_aliases in aliases.items():
            index = next((normalized[name] for name in field_aliases if name in normalized), None)
            if index is None:
                missing.append("/".join(field_aliases))
            else:
                indexes[field_name] = index
        if missing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="导入模板缺少列：" + "、".join(missing),
            )
        return indexes

    @staticmethod
    def _cell_value(values: tuple[object, ...], index: int) -> object | None:
        return values[index] if index < len(values) else None

    @staticmethod
    def _is_blank_row(values: tuple[object, ...]) -> bool:
        return all(value is None or str(value).strip() == "" for value in values)

    @staticmethod
    def _duplicate_codes(
        rows: Iterable[DistributorAllocationCreateDTO],
    ) -> list[str]:
        seen: set[str] = set()
        duplicates: list[str] = []
        for row in rows:
            if row.distributor_code in seen and row.distributor_code not in duplicates:
                duplicates.append(row.distributor_code)
            seen.add(row.distributor_code)
        return duplicates

    @staticmethod
    def _read_xlsx_rows(content: bytes) -> list[tuple[object, ...]]:
        """Read text and numeric values from the first .xlsx worksheet without Excel automation."""
        with ZipFile(BytesIO(content)) as archive:
            names = archive.namelist()
            sheet_names = sorted(
                name
                for name in names
                if name.startswith("xl/worksheets/sheet") and name.endswith(".xml")
            )
            if not sheet_names:
                raise ValueError("workbook has no worksheet")
            shared_strings = WorkbenchService._read_shared_strings(archive, names)
            worksheet = ElementTree.fromstring(archive.read(sheet_names[0]))

        parsed_rows: list[tuple[object, ...]] = []
        for row in worksheet.findall(f".//{SPREADSHEET_NAMESPACE}row"):
            values_by_index: dict[int, object | None] = {}
            for cell in row.findall(f"{SPREADSHEET_NAMESPACE}c"):
                coordinate = cell.attrib.get("r", "")
                column_index = WorkbenchService._column_index(coordinate)
                if column_index is None:
                    continue
                if cell.find(f"{SPREADSHEET_NAMESPACE}f") is not None:
                    values_by_index[column_index] = None
                    continue
                values_by_index[column_index] = WorkbenchService._xlsx_cell_value(
                    cell,
                    shared_strings,
                )
            if values_by_index:
                parsed_rows.append(
                    tuple(values_by_index.get(index) for index in range(max(values_by_index) + 1))
                )
        return parsed_rows

    @staticmethod
    def _read_shared_strings(archive: ZipFile, names: list[str]) -> list[str]:
        if "xl/sharedStrings.xml" not in names:
            return []
        root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
        return [
            "".join(item.itertext())
            for item in root.findall(f"{SPREADSHEET_NAMESPACE}si")
        ]

    @staticmethod
    def _xlsx_cell_value(cell: ElementTree.Element, shared_strings: list[str]) -> object | None:
        cell_type = cell.attrib.get("t")
        if cell_type == "inlineStr":
            inline = cell.find(f"{SPREADSHEET_NAMESPACE}is")
            return "".join(inline.itertext()) if inline is not None else ""
        value = cell.find(f"{SPREADSHEET_NAMESPACE}v")
        if value is None or value.text is None:
            return None
        if cell_type == "s":
            return shared_strings[int(value.text)]
        return value.text

    @staticmethod
    def _column_index(coordinate: str) -> int | None:
        letters = "".join(char for char in coordinate if char.isalpha())
        if not letters:
            return None
        result = 0
        for char in letters.upper():
            result = result * 26 + ord(char) - ord("A") + 1
        return result - 1
