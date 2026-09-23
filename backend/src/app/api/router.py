from fastapi import APIRouter

from app.controllers.test_controller import router as test_router
from app.controllers.workbench_controller import router as workbench_router

api_router = APIRouter()
api_router.include_router(test_router, prefix="/test", tags=["Test"])
api_router.include_router(workbench_router, prefix="/workbench", tags=["Workbench"])

