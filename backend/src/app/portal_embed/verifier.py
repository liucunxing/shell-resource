"""Strict portal-embed/1.0 validation; HS256 verification is provided by PyJWT.

The replay policy is time_bound: a valid assertion can be retried in its validity
window. The HTTP receiver must separately check Origin and account/resource access.
"""

import base64
import ipaddress
import json
import math
import re
import time
from collections.abc import Mapping
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any
from urllib.parse import urlsplit

import jwt

MAX_ASSERTION_BYTES = 16 * 1024
MAX_SAFE_INTEGER = 9007199254740991
_IDENTIFIER = re.compile(r"[A-Za-z0-9_-]{1,128}\Z")
_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\Z")
_SEGMENT = re.compile(r"[A-Za-z0-9_-]+\Z")
_HEADER_FIELDS = {"alg", "typ", "kid"}
_PAYLOAD_FIELDS = {
    "iss", "sub", "aud", "iat", "exp", "jti", "purpose", "schemaVersion",
    "resourceId", "requestId", "instanceId", "embedderOrigin", "claims",
}


class AssertionError(ValueError):
    """Safe error without an assertion, secret, or user data in its message."""

    def __init__(self, code: str = "ASSERTION_INVALID") -> None:
        self.code = code
        super().__init__(code)


def validate_address(value: str, *, allow_loopback_http: bool, origin_only: bool) -> None:
    """Reject browser-normalized aliases before using an address as a trust boundary."""
    try:
        if not isinstance(value, str) or not value or len(value) > 2048:
            raise ValueError
        if any(ord(c) <= 32 or ord(c) >= 127 for c in value) or "\\" in value:
            raise ValueError
        parts = urlsplit(value)
        host, port = parts.hostname, parts.port
        if not host or parts.username is not None or parts.password is not None:
            raise ValueError
        if "?" in value or "#" in value or (origin_only and parts.path):
            raise ValueError
        if parts.scheme != "https" and not (
            allow_loopback_http and parts.scheme == "http"
            and host in {"localhost", "127.0.0.1", "::1"}
        ):
            raise ValueError
        if port == 0 or port == (443 if parts.scheme == "https" else 80):
            raise ValueError
        if ":" in host:
            canonical_host = "[" + ipaddress.IPv6Address(host).compressed + "]"
        else:
            if re.fullmatch(r"(?:0x[0-9a-f]+|[0-9]+)(?:\.(?:0x[0-9a-f]+|[0-9]+))*", host):
                canonical_host = str(ipaddress.IPv4Address(host))
            else:
                labels = host.split(".")
                if len(host) > 253 or any(not re.fullmatch(
                    r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label
                ) for label in labels):
                    raise ValueError
                # WHATWG interprets a numeric last label as an IPv4 address.
                if re.fullmatch(r"(?:[0-9]+|0x[0-9a-f]+)", labels[-1]):
                    raise ValueError
                canonical_host = host
        canonical = parts.scheme + "://" + canonical_host
        if port is not None:
            canonical += ":" + str(port)
        canonical += parts.path
        if canonical != value:
            raise ValueError
    except (ValueError, TypeError) as exc:
        raise ValueError("Invalid receiver endpoint configuration") from exc


@dataclass(frozen=True, slots=True)
class ReceiverConfig:
    issuer: str
    audience: str
    keys: Mapping[str, str] = field(repr=False)
    parent_origins: frozenset[str]
    required_claims: frozenset[str]
    max_ttl_seconds: int = 60
    clock_skew_seconds: int = 5
    allow_loopback_http: bool = False
    _decoded_keys: Mapping[str, bytes] = field(init=False, repr=False, compare=False)

    def __post_init__(self) -> None:
        if not isinstance(self.audience, str) or not _IDENTIFIER.fullmatch(self.audience):
            raise ValueError("Invalid receiver audience configuration")
        if (type(self.max_ttl_seconds) is not int or not 1 <= self.max_ttl_seconds <= 60
                or type(self.clock_skew_seconds) is not int
                or not 0 <= self.clock_skew_seconds <= 5
                or type(self.allow_loopback_http) is not bool):
            raise ValueError("Invalid receiver time configuration")
        validate_address(self.issuer, allow_loopback_http=self.allow_loopback_http,
                         origin_only=False)
        if not self.parent_origins or isinstance(self.parent_origins, str):
            raise ValueError("Invalid receiver parent origins")
        for origin in self.parent_origins:
            validate_address(origin, allow_loopback_http=self.allow_loopback_http,
                             origin_only=True)
        if isinstance(self.required_claims, str) or any(
            not isinstance(name, str) or not name.strip() for name in self.required_claims
        ):
            raise ValueError("Invalid receiver required claims")
        decoded: dict[str, bytes] = {}
        try:
            if not self.keys:
                raise ValueError
            for kid, encoded in self.keys.items():
                if not isinstance(kid, str) or not _IDENTIFIER.fullmatch(kid):
                    raise ValueError
                if not isinstance(encoded, str):
                    raise ValueError
                key = base64.b64decode(encoded, validate=True)
                if not 32 <= len(key) <= 128 or base64.b64encode(key).decode("ascii") != encoded:
                    raise ValueError
                decoded[kid] = key
        except (ValueError, TypeError, AttributeError) as exc:
            raise ValueError("Invalid receiver key configuration") from exc
        object.__setattr__(self, "keys", MappingProxyType(dict(self.keys)))
        object.__setattr__(self, "_decoded_keys", MappingProxyType(decoded))
        object.__setattr__(self, "parent_origins", frozenset(self.parent_origins))
        object.__setattr__(self, "required_claims", frozenset(self.required_claims))


def _object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise AssertionError()
        value[key] = item
    return value


def _reject_constant(_: str) -> Any:
    raise AssertionError()


def _check_values(value: Any) -> None:
    if isinstance(value, str):
        value.encode("utf-8", errors="strict")
    elif isinstance(value, float) and not math.isfinite(value):
        raise AssertionError()
    elif isinstance(value, dict):
        for name, child in value.items():
            _check_values(name)
            _check_values(child)
    elif isinstance(value, list):
        for child in value:
            _check_values(child)


def _json(segment: str) -> dict[str, Any]:
    raw = base64.b64decode(segment + "=" * (-len(segment) % 4), altchars=b"-_", validate=True)
    text = raw.decode("utf-8", errors="strict")
    # Bound depth before the JSON parser allocates arbitrarily nested objects.
    depth = 0
    quoted = escaped = False
    for char in text:
        if quoted:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                quoted = False
        elif char == '"':
            quoted = True
        elif char in "[{":
            depth += 1
            if depth > 16:
                raise AssertionError()
        elif char in "]}":
            depth -= 1
    value = json.loads(text, object_pairs_hook=_object, parse_constant=_reject_constant)
    if not isinstance(value, dict):
        raise AssertionError()
    _check_values(value)
    return value


def _text(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def verify_assertion(
    assertion: str, config: ReceiverConfig, now: int | None = None,
) -> dict[str, Any]:
    """Verify fixed HS256 signature and all v1 claims, using an injectable test clock."""
    try:
        if not isinstance(assertion, str) or len(assertion.encode("utf-8")) > MAX_ASSERTION_BYTES:
            raise AssertionError()
        parts = assertion.split(".")
        if len(parts) != 3 or any(not _SEGMENT.fullmatch(part) for part in parts):
            raise AssertionError()
        header, body = _json(parts[0]), _json(parts[1])
        if set(header) != _HEADER_FIELDS or set(body) != _PAYLOAD_FIELDS:
            raise AssertionError()
        if header["alg"] != "HS256" or header["typ"] != "JWT" or not _text(header["kid"]):
            raise AssertionError()
        key = config._decoded_keys.get(header["kid"])
        if key is None:
            raise AssertionError()
        # PyJWT owns cryptographic verification. Its permissive/time-dependent
        # claim checks are replaced below by the fixed v1 contract and test clock.
        jwt.decode(assertion, key, algorithms=["HS256"], options={
            "verify_signature": True, "verify_exp": False, "verify_iat": False,
            "verify_nbf": False, "verify_aud": False, "verify_iss": False,
            "verify_sub": False, "verify_jti": False,
        })
        if (body["iss"] != config.issuer or body["aud"] != config.audience
                or body["purpose"] != "embed_login" or body["schemaVersion"] != "1.0"):
            raise AssertionError()
        subject, resource, origin = body["sub"], body["resourceId"], body["embedderOrigin"]
        if (not _text(subject) or len(subject) > 128
                or any(ord(c) < 32 or ord(c) == 127 for c in subject)
                or not isinstance(resource, str) or not _IDENTIFIER.fullmatch(resource)
                or not isinstance(origin, str) or origin not in config.parent_origins):
            raise AssertionError()
        for name in ("jti", "requestId", "instanceId"):
            if not isinstance(body[name], str) or not _UUID.fullmatch(body[name]):
                raise AssertionError()
        iat, exp = body["iat"], body["exp"]
        if any(
            type(value) is not int or not 0 <= value <= MAX_SAFE_INTEGER for value in (iat, exp)
        ):
            raise AssertionError()
        clock = int(time.time()) if now is None else now
        if type(clock) is not int or clock < 0:
            raise AssertionError()
        ttl, skew = config.max_ttl_seconds, config.clock_skew_seconds
        if exp <= iat or exp - iat > ttl or iat > clock + skew:
            raise AssertionError()
        if clock >= exp + skew or clock - iat > ttl + skew:
            raise AssertionError("ASSERTION_EXPIRED")
        claims = body["claims"]
        if not isinstance(claims, dict):
            raise AssertionError()
        for name in config.required_claims:
            value = claims.get(name)
            if value is None or (isinstance(value, str) and not value.strip()):
                raise AssertionError()
        return body
    except AssertionError:
        raise
    except (ValueError, TypeError, KeyError, UnicodeError, RecursionError, jwt.PyJWTError) as exc:
        raise AssertionError() from exc
