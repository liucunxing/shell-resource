"""Cross-language vectors and parser/configuration boundaries for portal-embed v1."""

import base64
import copy
import json
from dataclasses import replace
from pathlib import Path

import jwt
import pytest

from app.portal_embed.verifier import AssertionError as InvalidAssertion
from app.portal_embed.verifier import ReceiverConfig, verify_assertion

VECTORS = json.loads((Path(__file__).parent / "fixtures/portal_embed/test-vectors.json")
                     .read_text(encoding="utf-8"))
CONFIG = ReceiverConfig(
    issuer=VECTORS["config"]["issuer"], audience=VECTORS["config"]["audience"],
    keys=VECTORS["config"]["keys"],
    parent_origins=frozenset(VECTORS["config"]["allowedEmbedderOrigins"]),
    required_claims=frozenset(VECTORS["config"]["requiredClaims"]),
)
KEY = base64.b64decode(VECTORS["config"]["keys"]["small-test-01"])


def _sign(body=None):
    return jwt.encode(body or copy.deepcopy(VECTORS["vectors"][0]["payload"]), KEY,
                      algorithm="HS256", headers={"kid": "small-test-01", "typ": "JWT"})


def _raw_sign(text):
    return jwt.api_jws.encode(text.encode("utf-8"), KEY, algorithm="HS256",
                              headers={"kid": "small-test-01", "typ": "JWT"})


@pytest.mark.parametrize("vector", VECTORS["vectors"], ids=lambda vector: vector["name"])
def test_portal_java_contract_vectors(vector):
    if vector["expected"] == "valid":
        assert verify_assertion(vector["assertion"], CONFIG, vector["now"]) == vector["payload"]
    else:
        with pytest.raises(InvalidAssertion) as error:
            verify_assertion(vector["assertion"], CONFIG, vector["now"])
        assert error.value.code == vector["expected"]


@pytest.mark.parametrize("field,value", [
    ("iat", True), ("exp", False), ("iat", -1), ("exp", 9007199254740992),
    ("iat", 1793232000.0), ("exp", "1793232060"),
    ("sub", "\ud800"), ("claims", []),
])
def test_types_and_invalid_unicode_rejected(field, value):
    payload = copy.deepcopy(VECTORS["vectors"][0]["payload"])
    payload[field] = value
    with pytest.raises(InvalidAssertion, match="ASSERTION_INVALID"):
        verify_assertion(_sign(payload), CONFIG, VECTORS["now"])


@pytest.mark.parametrize("insert", [
    '"iat":1793232000,', '"claims":{},',
    '"claims":{"display_name":"a","display_name":"b"},',
])
def test_duplicate_payload_json_keys_rejected(insert):
    original = json.dumps(VECTORS["vectors"][0]["payload"])
    token = _raw_sign("{" + insert + original[1:])
    with pytest.raises(InvalidAssertion):
        verify_assertion(token, CONFIG, VECTORS["now"])


def test_duplicate_header_rejected():
    # Use the library's HS256 signer so a valid signature cannot hide duplicates.
    header = base64.urlsafe_b64encode(
        b'{"alg":"HS256","typ":"JWT","kid":"small-test-01","kid":"small-test-01"}'
    ).rstrip(b"=").decode()
    payload = _sign().split(".")[1]
    signing_input = (header + "." + payload).encode("ascii")
    signature = jwt.algorithms.get_default_algorithms()["HS256"].sign(signing_input, KEY)
    token = signing_input.decode("ascii") + "." + base64.urlsafe_b64encode(
        signature
    ).rstrip(b"=").decode("ascii")
    with pytest.raises(InvalidAssertion):
        verify_assertion(token, CONFIG, VECTORS["now"])


@pytest.mark.parametrize("value", ["NaN", "Infinity", "-Infinity", "1e309"])
def test_non_json_or_nonfinite_numbers_rejected(value):
    original = json.dumps(VECTORS["vectors"][0]["payload"])
    token = _raw_sign(original.replace('"D001"', value))
    with pytest.raises(InvalidAssertion):
        verify_assertion(token, CONFIG, VECTORS["now"])


def test_maximum_depth_and_size_are_enforced():
    body = copy.deepcopy(VECTORS["vectors"][0]["payload"])
    item = "value"
    for _ in range(14):
        item = [item]
    body["claims"]["nested"] = item  # Root + claims + 14 arrays = 16.
    verify_assertion(_sign(body), CONFIG, VECTORS["now"])
    body["claims"]["nested"] = [item]
    with pytest.raises(InvalidAssertion):
        verify_assertion(_sign(body), CONFIG, VECTORS["now"])
    body["claims"]["nested"] = "x" * 17000
    with pytest.raises(InvalidAssertion):
        verify_assertion(_sign(body), CONFIG, VECTORS["now"])


def test_time_bound_retry_and_expiry_boundaries():
    token = _sign()
    for _ in range(2):
        verify_assertion(token, CONFIG, 1793232064)
    with pytest.raises(InvalidAssertion, match="ASSERTION_EXPIRED"):
        verify_assertion(token, CONFIG, 1793232065)


@pytest.mark.parametrize("origin", [
    "http://portal.example.com", "https://portal.example.com/", "null",
    "https://portal.example.com:443", "https://PORTAL.example.com",
    "https://portal.example.com:0", "https://portal.example.com:65536",
    "https://portal.example.com?", "https://portal.example.com#",
    "https://evil@portal.example.com", "https://portal.example.com\\@evil.test",
    "https://127.1", "https://127.000.0.1", "https://0x7f000001",
    "https://portal.example.com:0443", "https://portal.example.com\n",
    "https://portal.123", "https://portal.example.com.",
])
def test_noncanonical_config_origin_rejected(origin):
    with pytest.raises(ValueError):
        replace(CONFIG, parent_origins=frozenset({origin}))


def test_loopback_requires_explicit_configuration():
    with pytest.raises(ValueError):
        replace(CONFIG, issuer="http://127.0.0.1:8081")
    for origin in ("http://127.0.0.1:8081", "http://localhost:8081", "http://[::1]:8081"):
        replace(CONFIG, issuer=origin, parent_origins=frozenset({origin}), allow_loopback_http=True)


@pytest.mark.parametrize("key", ["", " ", "not-base64",
    base64.b64encode(b"x" * 31).decode(), base64.b64encode(b"x" * 129).decode(),
    base64.b64encode(KEY).decode().rstrip("="),
    base64.b64encode(KEY).decode() + "\n",
])
def test_invalid_config_keys_rejected(key):
    with pytest.raises(ValueError):
        replace(CONFIG, keys={"small-test-01": key})


def test_config_copies_mutable_input_and_never_prints_secret():
    keys = dict(CONFIG.keys)
    origins = set(CONFIG.parent_origins)
    config = replace(CONFIG, keys=keys, parent_origins=origins)
    keys.clear()
    origins.clear()
    verify_assertion(_sign(), config, VECTORS["now"])
    assert CONFIG.keys["small-test-01"] not in repr(config)
    with pytest.raises(TypeError):
        config.keys["new"] = "invalid"


@pytest.mark.parametrize("field,value", [
    ("max_ttl_seconds", True), ("max_ttl_seconds", 61), ("max_ttl_seconds", 0),
    ("clock_skew_seconds", 6), ("clock_skew_seconds", -1), ("clock_skew_seconds", True),
    ("allow_loopback_http", "false"), ("audience", "app/value"),
])
def test_invalid_contract_configuration_rejected(field, value):
    with pytest.raises(ValueError):
        replace(CONFIG, **{field: value})
