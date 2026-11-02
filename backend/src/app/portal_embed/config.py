"""Trusted deployment settings for the independent Portal receiver."""

import re
from dataclasses import dataclass
from urllib.parse import urlsplit

from app.core.config import Settings
from app.portal_embed.verifier import ReceiverConfig

COOKIE_NAME = "RESOURCE_PORTAL_SESSION"
PREFIX = "/portal-embed"
LANDING_PATH = PREFIX + "/workbench"
UUID_PATTERN = re.compile(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\Z")
TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_-]{43}\Z")
EMAIL_LOCAL = re.compile(r"[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*\Z")
EMAIL_LABEL = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\Z")


def normalized_email(value: object) -> str:
    if not isinstance(value, str) or len(value) > 254 or value.count("@") != 1:
        raise ValueError("Invalid trusted email")
    local, domain = value.split("@")
    labels = domain.split(".")
    if (
        not 1 <= len(local) <= 64
        or not EMAIL_LOCAL.fullmatch(local)
        or len(labels) < 2
        or any(not EMAIL_LABEL.fullmatch(label) for label in labels)
    ):
        raise ValueError("Invalid trusted email")
    return value.lower()


@dataclass(frozen=True)
class PortalConfig:
    verifier: ReceiverConfig
    resource_origin: str
    app_id: str
    cookie_secure: bool
    cookie_samesite: str
    session_ttl_seconds: int

    @classmethod
    def from_settings(cls, settings: Settings) -> "PortalConfig":
        if not settings.resource_portal_enabled:
            raise ValueError("Receiver disabled")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", settings.resource_portal_app_id):
            raise ValueError("Invalid Portal app id")
        key = settings.resource_portal_key
        verifier = ReceiverConfig(
            issuer=settings.resource_portal_issuer,
            audience=settings.resource_portal_audience,
            keys={settings.resource_portal_kid: key.get_secret_value() if key else ""},
            parent_origins=set(settings.resource_portal_parent_origins),
            required_claims={"email"},
            allow_loopback_http=settings.resource_portal_allow_loopback_http,
        )
        # Reuse the verifier's trusted-origin validation for the receiver origin too.
        ReceiverConfig(
            issuer=settings.resource_portal_issuer,
            audience=settings.resource_portal_audience,
            keys={settings.resource_portal_kid: key.get_secret_value() if key else ""},
            parent_origins={settings.resource_portal_origin},
            required_claims={"email"},
            allow_loopback_http=settings.resource_portal_allow_loopback_http,
        )
        origin = urlsplit(settings.resource_portal_origin)
        if not settings.resource_portal_cookie_secure and not (
            settings.resource_portal_allow_loopback_http
            and settings.app_env != "production"
            and origin.scheme == "http"
            and origin.hostname in {"localhost", "127.0.0.1", "::1"}
        ):
            raise ValueError("Insecure cookie permitted only for explicit loopback testing")
        if settings.app_env == "production" and settings.resource_portal_allow_loopback_http:
            raise ValueError("Loopback testing must be disabled in production")
        if (
            settings.resource_portal_cookie_samesite == "none"
            and not settings.resource_portal_cookie_secure
        ):
            raise ValueError("SameSite=None requires Secure")
        return cls(
            verifier,
            settings.resource_portal_origin,
            settings.resource_portal_app_id,
            settings.resource_portal_cookie_secure,
            settings.resource_portal_cookie_samesite,
            settings.resource_portal_session_ttl_seconds,
        )
