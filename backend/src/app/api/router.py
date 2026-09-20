from fastapi import APIRouter

from app.controllers.test_controller import router as test_router

api_router = APIRouter()
api_router.include_router(test_router, prefix="/test", tags=["Test"])

