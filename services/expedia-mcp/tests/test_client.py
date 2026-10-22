import logging

import httpx
import pytest
from pydantic import SecretStr

from expedia_recommendations_mcp.client import ExpediaClient
from expedia_recommendations_mcp.contracts import HotelQuery


async def test_success_does_not_log_credentials_or_traveller_query(
    caplog: pytest.LogCaptureFixture,
) -> None:
    credential = "expedia-test-credential-not-real"
    private_query = "private-query-not-for-logs"
    seen: list[httpx.Request] = []

    def upstream(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"hotels": [{"name": "Sample", "price": "12.30"}]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as http:
        with caplog.at_level(logging.DEBUG):
            result = await ExpediaClient(http, key=SecretStr(credential), enabled=True).search(
                "hotels", HotelQuery(destination="Paris", query_text=private_query)
            )
    assert result.status == "ok"
    assert result.data == {"hotels": [{"name": "Sample", "price": "12.30"}]}
    assert credential not in caplog.text
    assert private_query not in caplog.text
    assert seen[0].url.host == "apim.expedia.com"
    assert seen[0].url.path == "/recommendations/hotels"
    assert seen[0].headers["X-API-KEY"] == credential
    assert "Authorization" not in seen[0].headers
    assert seen[0].url.params["user_input_in_english"] == private_query
    assert seen[0].url.params["keywords"] == "Hotels|MCP"


@pytest.mark.parametrize("code", [301, 302, 401, 403, 429, 500, 503])
async def test_failures_do_not_retry_fallback_redirect_or_return_payload(code: int) -> None:
    seen: list[httpx.Request] = []

    def upstream(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(
            code,
            headers={"Location": "http://169.254.169.254"},
            json={"error": "private-upstream-detail"},
        )

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(upstream), follow_redirects=True
    ) as http:
        result = await ExpediaClient(http, key=SecretStr("dummy-key"), enabled=True).search(
            "hotels", HotelQuery(destination="Paris")
        )
    assert result.model_dump() == {"status": "unavailable", "data": None}
    assert len(seen) == 1
    assert seen[0].extensions["timeout"] == {"connect": 3, "read": 5, "write": 5, "pool": 1}


async def test_timeout_returns_no_exception_details(caplog: pytest.LogCaptureFixture) -> None:
    def upstream(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("dummy-key private-query", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as http:
        with caplog.at_level(logging.DEBUG):
            result = await ExpediaClient(http, key=SecretStr("dummy-key"), enabled=True).search(
                "hotels", HotelQuery(destination="Paris")
            )
    assert result.model_dump() == {"status": "unavailable", "data": None}
    assert "dummy-key" not in caplog.text
    assert "private-query" not in caplog.text


@pytest.mark.parametrize(
    "body",
    [
        b'{"price":12.30,"price":0.01}',
        b'{"price":NaN}',
        b"not-json",
        b'"plain-string"',
        b'{"token":"dummy-key"}',
        b'{"nested":' + b"[" * 20 + b"0" + b"]" * 20 + b"}",
        b'{"items":[' + b"0," * 500 + b"0]}",
        b'{"text":"' + b"x" * 131072 + b'"}',
    ],
)
async def test_unsafe_or_unbounded_upstream_content_is_rejected(body: bytes) -> None:
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                200, content=body, headers={"Content-Type": "application/json"}
            )
        )
    ) as http:
        result = await ExpediaClient(http, key=SecretStr("dummy-key"), enabled=True).search(
            "hotels", HotelQuery(destination="Paris")
        )
    assert result.model_dump() == {"status": "unavailable", "data": None}


async def test_decimal_prices_keep_exact_precision() -> None:
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                200,
                content=b'{"price":123456789.123456789}',
                headers={"Content-Type": "application/json"},
            )
        )
    ) as http:
        result = await ExpediaClient(http, key=SecretStr("dummy-key"), enabled=True).search(
            "hotels", HotelQuery(destination="Paris")
        )
    assert result.data == {"price": "123456789.123456789"}


@pytest.mark.parametrize("key,enabled", [("", True), ("dummy-key", False)])
async def test_unconfigured_provider_makes_no_network_request(key: str, enabled: bool) -> None:
    def upstream(request: httpx.Request) -> httpx.Response:
        pytest.fail("unconfigured provider contacted upstream")

    async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as http:
        result = await ExpediaClient(http, key=SecretStr(key), enabled=enabled).search(
            "hotels", HotelQuery(destination="Paris")
        )
    assert result.status == "unavailable"
