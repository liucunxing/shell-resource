"""Administrator-only, non-persistent trials through a user's real data scope."""

import hashlib
from typing import Any, Self

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.dependencies.workbench_user import WorkbenchUser, get_current_workbench_user
from app.models.do.insight import InsightPromptDO
from app.services.insight_service import DEFAULT_PROMPT, InsightService


class InsightPreviewService(InsightService):
    actor: WorkbenchUser

    @classmethod
    async def create(
        cls, session: AsyncSession, actor: WorkbenchUser, email: str, settings: Settings
    ) -> Self:
        cls._assert_admin(actor)
        target = await get_current_workbench_user(session, x_user_email=email)
        service = cls(session, target, settings, persist_results=False)
        service.actor = actor
        return service

    @staticmethod
    def _assert_admin(actor: WorkbenchUser) -> None:
        if actor.role != "admin":
            raise HTTPException(status_code=403, detail="仅管理员可试用用户视角")

    def _log(self, level: int, message: str, *args: Any) -> None:
        self._log_context = {
            **getattr(self, "_log_context", {}),
            "mode": "admin_preview",
            "actor_hash": hashlib.sha256(self.actor.email.encode()).hexdigest()[:16],
        }
        super()._log(level, message, *args)

    async def _refresh_user(self) -> None:
        self.session.expire_all()
        self.actor = await get_current_workbench_user(self.session, x_user_email=self.actor.email)
        self._assert_admin(self.actor)
        await super()._refresh_user()

    async def _prompt(self, planning_year: int, scope: str, descriptor: dict) -> InsightPromptDO:
        # Trials always use the saved global prompt, never an old per-user prompt.
        prompt = await self.repository.get_prompt(planning_year, "global")
        return (
            prompt
            if prompt is not None
            else InsightPromptDO(
                planning_year=planning_year, scope="global", text=DEFAULT_PROMPT, version=0
            )
        )

    async def context(self, planning_year: int) -> dict:
        workspace = await self._workspace(planning_year)
        items = workspace["state"].get("initiatives") or []
        if self.user.role == "owner":
            scopes = [{"id": f"owner:{self.user.email}", "label": "全部负责项目"}]
            scopes += [
                {
                    "id": f"initiative:{item['id']}",
                    "label": f"{item['name']} · {item['resourceType']} / {item['sector']}",
                }
                for item in items
            ]
        elif self.user.role == "lead":
            scopes = [{"id": dep, "label": f"{dep} 部门工作稿"} for dep in self.user.departments]
        else:
            scopes = [{"id": "global", "label": "各项最新同步结果"}]
        # Do not return the admin workspace, dealer rows or the target's saved Insight.
        return {
            "identity": {
                "email": self.user.email,
                "label": self.user.display_name,
                "role": self.user.role,
                "department": list(self.user.departments),
            },
            "scopes": scopes,
            "basisLabel": "各项最新同步快照"
            if self.user.role in {"management", "admin"}
            else "当前授权工作稿",
        }

    async def generate(
        self, *, scope: str, planning_year: int, preset_id: str = "comprehensive"
    ) -> dict[str, Any]:
        record = await super().generate(
            scope=scope, planning_year=planning_year, preset_id=preset_id
        )
        record["simulation"] = {
            "email": self.user.email,
            "label": self.user.display_name,
            "role": self.user.role,
            "persisted": False,
        }
        return record
