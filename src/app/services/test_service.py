from datetime import UTC, datetime

from app.core.config import get_settings
from app.schemas.dto.test import EchoDTO
from app.schemas.vo.test import EchoVO, PingVO


class TestService:
    """Non-business service used only to verify the project skeleton."""

    def ping(self) -> PingVO:
        settings = get_settings()
        return PingVO(
            message="pong",
            environment=settings.app_env,
            timestamp=datetime.now(UTC),
        )

    def echo(self, payload: EchoDTO) -> EchoVO:
        return EchoVO(message=payload.message)

