from fastapi import HTTPException, status

from app.security.sso import SSOPrincipal


async def require_sso_principal() -> SSOPrincipal:
    """Reserved dependency for protected routes after SSO integration is selected."""
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="SSO authentication provider is not configured",
    )

