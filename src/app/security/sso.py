from typing import Protocol

from pydantic import BaseModel, Field


class SSOPrincipal(BaseModel):
    """Normalized user identity independent of a future SAML/OIDC vendor."""

    subject: str
    display_name: str | None = None
    email: str | None = None
    roles: list[str] = Field(default_factory=list)


class SSOAuthenticator(Protocol):
    """Contract to implement after the SSO protocol/provider is confirmed."""

    async def authenticate(self, credential: str) -> SSOPrincipal: ...
