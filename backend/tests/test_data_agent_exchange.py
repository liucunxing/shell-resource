import json
import logging
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from fastapi import HTTPException

from app.services.data_agent_exchange import exchange_data_agent_ticket

ORIGIN = "https://agent.example.test"
EMAIL = "member@example.test"
KEY = "synthetic-service-secret"
TOKEN = "synthetic-user-token+/=&"


def mock_vendor(monkeypatch, handler):
    original_client = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kw: original_client(transport=httpx.MockTransport(handler), **kw),
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("wrapped", [True, False])
async def test_ticket_exchange_checks_identity_and_encodes_url(monkeypatch, caplog, wrapped):
    def respond(request):
        assert request.method == "POST"
        assert str(request.url) == ORIGIN + "/api/yiaskAuth:issueUserToken"
        assert request.headers["Authorization"] == "Bearer " + KEY
        assert request.headers["Referer"] == ORIGIN + "/"
        assert json.loads(request.content) == {"email": EMAIL}
        result = {"user": {"email": EMAIL.upper()}, "token": TOKEN}
        return httpx.Response(200, json={"data": result} if wrapped else result)

    mock_vendor(monkeypatch, respond)
    with caplog.at_level(logging.DEBUG):
        url = await exchange_data_agent_ticket(
            origin=ORIGIN + "/", email=EMAIL.upper(), api_token=KEY, space="stage/one"
        )
    parsed = urlsplit(url)
    assert (parsed.scheme, parsed.netloc, parsed.path) == (
        "https",
        "agent.example.test",
        "/admin/chat",
    )
    assert parse_qs(parsed.query) == {"token": [TOKEN], "space": ["stage/one"]}
    assert TOKEN not in caplog.text and KEY not in caplog.text


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "failure",
    [
        "redirect",
        "timeout",
        "too_large",
        "malformed",
        "wrong_user",
        "empty",
        "unsafe_token",
        "long_token",
        "compression",
    ],
)
async def test_rejects_failed_or_untrusted_vendor_responses(monkeypatch, failure):
    requests = []

    def respond(request):
        requests.append(request.url)
        if failure == "redirect":
            return httpx.Response(302, headers={"Location": "https://other.example.test/"})
        if failure == "timeout":
            raise httpx.ReadTimeout(TOKEN)
        if failure == "too_large":
            return httpx.Response(200, content=b" " * 65537)
        if failure == "malformed":
            return httpx.Response(200, text=TOKEN)
        if failure == "compression":
            return httpx.Response(200, headers={"Content-Encoding": "unexpected"})
        email = "other@example.test" if failure == "wrong_user" else EMAIL
        token = {"empty": "", "unsafe_token": TOKEN + "\r\n", "long_token": "x" * 16001}.get(
            failure, TOKEN
        )
        return httpx.Response(200, json={"user": {"email": email}, "token": token})

    mock_vendor(monkeypatch, respond)
    with pytest.raises(HTTPException) as caught:
        await exchange_data_agent_ticket(origin=ORIGIN, email=EMAIL, api_token=KEY)
    assert len(requests) == 1 and caught.value.status_code == 502
    assert TOKEN not in str(caught.value) and KEY not in str(caught.value)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("change", "status"),
    [
        ({"origin": "http://agent.example.test"}, 503),
        ({"origin": "https://a:b@agent.example.test"}, 503),
        ({"origin": ORIGIN + "?redirect=x"}, 503),
        ({"api_token": ""}, 503),
        ({"space": "a\nb"}, 503),
        ({"email": "invalid"}, 403),
    ],
)
async def test_invalid_inputs_fail_before_network(monkeypatch, change, status):
    mock_vendor(monkeypatch, lambda request: pytest.fail("No request expected"))
    args = {"origin": ORIGIN, "email": EMAIL, "api_token": KEY, **change}
    with pytest.raises(HTTPException) as caught:
        await exchange_data_agent_ticket(**args)
    assert caught.value.status_code == status
