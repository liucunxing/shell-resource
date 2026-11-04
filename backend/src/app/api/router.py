from fastapi import APIRouter

from app.controllers.data_agent_controller import router as data_agent_router
from app.controllers.insight_controller import router as insight_router
from app.controllers.test_controller import router as test_router
from app.controllers.workbench_controller import router as workbench_router

api_router = APIRouter()
api_router.include_router(test_router, prefix="/test", tags=["Test"])
api_router.include_router(workbench_router, prefix="/workbench", tags=["Workbench"])
api_router.include_router(insight_router, prefix="/workbench", tags=["Insight"])
api_router.include_router(data_agent_router, prefix="/workbench", tags=["Data Agent"])

