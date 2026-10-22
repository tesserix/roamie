import asyncio
import copy
import logging
from datetime import UTC, datetime

import httpx
import pytest
from pydantic import SecretStr

from open_meteo_mcp.client import OpenMeteoClient
from open_meteo_mcp.contracts import ForecastQuery


def provider_payload():
    return {
        "timezone": "Australia/Melbourne",
        "utc_offset_seconds": 39600,
        "daily_units": {
            "time": "iso8601",
            "weather_code": "wmo code",
            "temperature_2m_max": "°C",
            "temperature_2m_min": "°C",
            "precipitation_probability_max": "%",
            "uv_index_max": "",
        },
        "daily": {
            "time": ["2026-10-13"],
            "weather_code": [3],
            "temperature_2m_max": [23.2],
            "temperature_2m_min": [12.1],
            "precipitation_probability_max": [20],
            "uv_index_max": [5.6],
        },
    }


async def test_commercial_forecast_uses_fixed_endpoint_and_preserves_local_units():
    def upstream(req):
        assert str(req.url).startswith("https://customer-api.open-meteo.com/v1/forecast?")
        assert req.url.params["apikey"] == "synthetic-provider-key"
        assert req.url.params["timezone"] == "auto"
        assert req.url.params["forecast_days"] == "1"
        assert req.url.params["temperature_unit"] == "celsius"
        assert "hourly" not in req.url.params
        return httpx.Response(200, json=provider_payload())

    async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as http:
        result = await OpenMeteoClient(
            http,
            key=SecretStr("synthetic-provider-key"),
            enabled=True,
            clock=lambda: datetime(2026, 10, 12, 20, tzinfo=UTC),
        ).forecast(ForecastQuery(latitude=-37.8, longitude=145.0, forecast_days=1))
    assert result.status == "ok"
    assert result.timezone == "Australia/Melbourne"
    assert str(result.days[0].local_date) == "2026-10-13"
    assert result.model_dump(mode="json")["days"][0]["maximum_celsius"] == "23.2"
    assert result.observed_at == "2026-10-12T20:00:00+00:00"
    assert result.attribution == "Weather data by Open-Meteo (CC BY 4.0)"


def malformed_responses():
    duplicate = '{"timezone":"Australia/Melbourne","timezone":"UTC","daily":{}}'
    bad = []
    for mutate in (
        lambda p: p["daily_units"].update(temperature_2m_max="°F"),
        lambda p: p["daily"]["temperature_2m_max"].clear(),
        lambda p: p["daily"].update(time=["2020-01-01"]),
        lambda p: p["daily"].update(uv_index_max=[None]),
        lambda p: p["daily"].update(temperature_2m_min=[40]),
        lambda p: p.update(timezone="synthetic-provider-key"),
        lambda p: p.update(timezone=""),
        lambda p: p["daily"].update(temperature_2m_max=["23." + "0" * 40]),
        lambda p: p.update(injected="synthetic-provider-key"),
    ):
        payload = copy.deepcopy(provider_payload())
        mutate(payload)
        bad.append(httpx.Response(200, json=payload))
    return [
        *bad,
        httpx.Response(200, text=duplicate, headers={"Content-Type": "application/json"}),
        httpx.Response(200, text='{"data":NaN}', headers={"Content-Type": "application/json"}),
        httpx.Response(
            200,
            content=b'{"x":"' + b"x" * 65536 + b'"}',
            headers={"Content-Type": "application/json"},
        ),
        httpx.Response(200, text="<html>error</html>"),
        httpx.Response(302, headers={"Location": "http://169.254.169.254"}),
        httpx.Response(429, json={"reason": "synthetic-provider-key"}),
    ]


@pytest.mark.parametrize("response", malformed_responses())
async def test_invalid_units_stale_dates_secret_reflection_and_unbounded_data_fail_closed(response):
    calls = []

    def upstream(req):
        calls.append(req)
        return response

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(upstream), follow_redirects=True
    ) as http:
        result = await OpenMeteoClient(
            http,
            key=SecretStr("synthetic-provider-key"),
            enabled=True,
            clock=lambda: datetime(2026, 10, 12, 20, tzinfo=UTC),
        ).forecast(ForecastQuery(latitude=-37.8, longitude=145.0, forecast_days=1))
    assert result.status == "unavailable"
    assert result.days == ()
    assert len(calls) == 1
    assert "synthetic-provider-key" not in result.model_dump_json()


async def test_disabled_provider_never_contacts_upstream():
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda req: pytest.fail("disabled provider called"))
    ) as http:
        result = await OpenMeteoClient(http).forecast(ForecastQuery(latitude=0, longitude=0))
    assert result.status == "unavailable"


async def test_evaluation_mode_never_sends_credentials(caplog):
    def upstream(req):
        assert req.url.host == "api.open-meteo.com"
        assert "apikey" not in req.url.params
        return httpx.Response(200, json=provider_payload())

    with caplog.at_level(logging.DEBUG):
        async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as http:
            result = await OpenMeteoClient(
                http,
                mode="evaluation",
                enabled=True,
                clock=lambda: datetime(2026, 10, 12, 20, tzinfo=UTC),
            ).forecast(ForecastQuery(latitude=-37.8, longitude=145.0, forecast_days=1))
    assert result.status == "ok"
    assert "latitude" not in caplog.text


async def test_timeout_returns_unavailable_without_exception_details():
    async def upstream(req):
        raise httpx.ReadTimeout("secret-query-value", request=req)

    async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as http:
        result = await OpenMeteoClient(http, mode="evaluation", enabled=True).forecast(
            ForecastQuery(latitude=0, longitude=0)
        )
    assert result.status == "unavailable"
    assert "secret-query-value" not in result.model_dump_json()


async def test_cancellation_propagates():
    async def upstream(req):
        raise asyncio.CancelledError

    async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as http:
        with pytest.raises(asyncio.CancelledError):
            await OpenMeteoClient(http, mode="evaluation", enabled=True).forecast(
                ForecastQuery(latitude=0, longitude=0)
            )
