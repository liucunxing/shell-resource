from fastapi import APIRouter

from app.api.v1.test import router as test_router

api_router = APIRouter()
api_router.include_router(test_router, prefix="/test", tags=["Test"])

