import json
import logging
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from fastapi import HTTPException

from app.services.data_agent_exchange import _literal_ilike, exchange_data_agent_ticket

ORIGIN = "https://agent.example.test"
EMAIL = "member@example.test"
KEY = "synthetic-service-secret"
TOKEN = "synthetic-user-token+/=&"
USER_ID = 103


def directory_payload(*, email=EMAIL, count=1):
    return {
        "data": [{"id": USER_ID + index, "email": email} for index in range(min(count, 2))],
        "meta": {"count": count, "page": 1, "pageSize": 2, "totalPage": (count + 1) // 2},
    }


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
    requests = []

    def respond(request):
        requests.append(request)
        assert request.headers["Authorization"] == "Bearer " + KEY
        assert request.headers["Referer"] == ORIGIN + "/"
        assert request.headers["Accept-Encoding"] == "identity"
        assert request.headers["x-spaces"] == "stage/one"
        if request.method == "GET":
            assert request.url.path == "/api/users:list"
            params = request.url.params
            assert params["page"] == "1" and params["pageSize"] == "2"
            assert params.get_list("fields[]") == ["id", "email"]
            assert json.loads(params["filter"]) == {"email": {"$iLike": EMAIL}}
            return httpx.Response(200, json=directory_payload(email=EMAIL.upper()))
        assert request.method == "POST"
        assert str(request.url) == ORIGIN + "/api/yiaskAuth:issueUserToken"
        assert json.loads(request.content) == {"email": EMAIL.upper()}
        result = {"user": {"id": USER_ID, "email": EMAIL}, "token": TOKEN}
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
    assert [request.method for request in requests] == ["GET", "POST"]
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
        "wrong_id",
        "missing_id",
        "boolean_id",
        "string_id",
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
        if request.method == "GET":
            return httpx.Response(200, json=directory_payload())
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
        user = {"email": email, "id": USER_ID}
        if failure == "wrong_id":
            user["id"] = USER_ID + 1
        elif failure == "missing_id":
            del user["id"]
        elif failure == "boolean_id":
            user["id"] = True
        elif failure == "string_id":
            user["id"] = str(USER_ID)
        return httpx.Response(200, json={"user": user, "token": token})

    mock_vendor(monkeypatch, respond)
    with pytest.raises(HTTPException) as caught:
        await exchange_data_agent_ticket(origin=ORIGIN, email=EMAIL, api_token=KEY)
    assert len(requests) == 2 and caught.value.status_code == 502
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
        ({"space": "空间"}, 503),
        ({"email": "invalid"}, 403),
        ({"email": "back\\slash@example.test"}, 403),
    ],
)
async def test_invalid_inputs_fail_before_network(monkeypatch, change, status):
    mock_vendor(monkeypatch, lambda request: pytest.fail("No request expected"))
    args = {"origin": ORIGIN, "email": EMAIL, "api_token": KEY, **change}
    with pytest.raises(HTTPException) as caught:
        await exchange_data_agent_ticket(**args)
    assert caught.value.status_code == status


@pytest.mark.asyncio
@pytest.mark.parametrize("count,status,message", [
    (0, 403, "当前邮箱尚未开通 Data Agent 账号"),
    (2, 502, "Data Agent 邮箱对应多个账号，请联系管理员"),
    (3, 502, "Data Agent 邮箱对应多个账号，请联系管理员"),
])
async def test_missing_or_ambiguous_directory_identity_never_issues_ticket(
    monkeypatch, count, status, message,
):
    def respond(request):
        assert request.method == "GET"
        return httpx.Response(200, json=directory_payload(count=count))

    mock_vendor(monkeypatch, respond)
    with pytest.raises(HTTPException) as caught:
        await exchange_data_agent_ticket(origin=ORIGIN, email=EMAIL, api_token=KEY)
    assert caught.value.status_code == status
    assert caught.value.detail == message


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", [
    "redirect", "timeout", "forbidden", "too_large", "compression", "malformed",
    "wrong_email", "invalid_email_type", "invalid_id", "boolean_id", "string_id",
    "missing_meta", "wrong_page", "wrong_page_size", "wrong_total_page", "boolean_count",
    "negative_count", "inconsistent_count", "extra_users", "not_a_list", "not_an_object",
    "not_a_user",
])
async def test_rejects_untrusted_directory_before_ticket_exchange(monkeypatch, failure):
    requests = []

    def respond(request):
        requests.append(request)
        assert request.method == "GET"
        if failure == "redirect":
            return httpx.Response(302, headers={"Location": "https://other.example.test/"})
        if failure == "timeout":
            raise httpx.ReadTimeout(KEY)
        if failure == "forbidden":
            return httpx.Response(403, text=KEY)
        if failure == "too_large":
            return httpx.Response(200, content=b" " * 65537)
        if failure == "compression":
            return httpx.Response(200, headers={"Content-Encoding": "unexpected"})
        if failure == "malformed":
            return httpx.Response(200, text=KEY)
        payload = directory_payload()
        if failure == "wrong_email":
            payload["data"][0]["email"] = "another@example.test"
        elif failure == "invalid_email_type":
            payload["data"][0]["email"] = [EMAIL]
        elif failure in {"invalid_id", "boolean_id", "string_id"}:
            payload["data"][0]["id"] = {
                "invalid_id": 0, "boolean_id": True, "string_id": str(USER_ID),
            }[failure]
        elif failure == "missing_meta":
            del payload["meta"]
        elif failure == "wrong_page":
            payload["meta"]["page"] = 2
        elif failure == "wrong_page_size":
            payload["meta"]["pageSize"] = 20
        elif failure == "wrong_total_page":
            payload["meta"]["totalPage"] = 0
        elif failure == "boolean_count":
            payload["meta"]["count"] = True
        elif failure == "negative_count":
            payload["meta"]["count"] = -1
        elif failure == "inconsistent_count":
            payload["meta"]["count"] = 2
        elif failure == "extra_users":
            payload["data"] *= 3
        elif failure == "not_a_list":
            payload["data"] = {}
        elif failure == "not_an_object":
            payload = []
        elif failure == "not_a_user":
            payload["data"] = [None]
        return httpx.Response(200, json=payload)

    mock_vendor(monkeypatch, respond)
    with pytest.raises(HTTPException) as caught:
        await exchange_data_agent_ticket(origin=ORIGIN, email=EMAIL, api_token=KEY)
    assert len(requests) == 1 and caught.value.status_code == 502
    assert TOKEN not in str(caught.value) and KEY not in str(caught.value)


def test_ilike_escapes_backslash_percent_and_underscore():
    assert _literal_ilike("a\\b%c_d@example.test") == "a\\\\b\\%c\\_d@example.test"


@pytest.mark.asyncio
@pytest.mark.parametrize("email", ["first_last@example.test", "percent%name@example.test"])
async def test_directory_search_treats_email_wildcards_literally(monkeypatch, email):
    def respond(request):
        if request.method == "GET":
            pattern = json.loads(request.url.params["filter"])["email"]["$iLike"]
            assert pattern == email.replace("%", "\\%").replace("_", "\\_")
            return httpx.Response(200, json=directory_payload(email=email.upper()))
        assert json.loads(request.content) == {"email": email.upper()}
        return httpx.Response(200, json={
            "user": {"id": USER_ID, "email": email}, "token": TOKEN,
        })

    mock_vendor(monkeypatch, respond)
    url = await exchange_data_agent_ticket(origin=ORIGIN, email=email, api_token=KEY)
    assert parse_qs(urlsplit(url).query)["token"] == [TOKEN]
