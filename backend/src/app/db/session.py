from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings

settings = get_settings()
engine = create_async_engine(
    settings.database_url.get_secret_value(),
    # SQL statements use the application's console logger to avoid duplicate
    # lines from SQLAlchemy's built-in echo handler.
    echo=False,
    hide_parameters=settings.app_env == "production",
    pool_pre_ping=True,
)
AsyncSessionFactory = async_sessionmaker(engine, expire_on_commit=False)


async def get_db_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency that owns one transaction-capable database session."""
    async with AsyncSessionFactory() as session:
        yield session

