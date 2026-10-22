import asyncio
import json
import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Literal

import httpx
from pydantic import JsonValue, SecretStr, TypeAdapter
from tesserix_mcp_runtime import SecretRedactor, SecretValue

from open_meteo_mcp.contracts import ForecastDay, ForecastQuery, ForecastResult

JSON = TypeAdapter(JsonValue)


def unique_object(pairs: list[tuple[str, JsonValue]]) -> dict[str, JsonValue]:
    result: dict[str, JsonValue] = {}
    for name, value in pairs:
        if name in result:
            raise ValueError("duplicate JSON property")
        result[name] = value
    return result


def reject_constant(value: str) -> None:
    raise ValueError("nonfinite JSON number")


DAILY = (
    "weather_code",
    "temperature_2m_max",
    "temperature_2m_min",
    "precipitation_probability_max",
    "uv_index_max",
)
UNITS = {
    "time": "iso8601",
    "weather_code": "wmo code",
    "temperature_2m_max": "°C",
    "temperature_2m_min": "°C",
    "precipitation_probability_max": "%",
    "uv_index_max": "",
}


def suppress_http_payload_logs() -> None:
    # Commercial authentication is an upstream query parameter; never log HTTP URLs.
    for name in ("httpx", "httpcore"):
        logger = logging.getLogger(name)
        logger.handlers = [logging.NullHandler()]
        logger.propagate = False


class OpenMeteoClient:
    def __init__(
        self,
        http: httpx.AsyncClient,
        *,
        key: SecretStr | None = None,
        enabled: bool = False,
        mode: Literal["commercial", "evaluation"] = "commercial",
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        key = key or SecretStr("")
        raw_key = key.get_secret_value()
        if (
            mode not in ("commercial", "evaluation")
            or len(raw_key) > 4096
            or any(not 33 <= ord(c) < 127 for c in raw_key)
        ):
            raise ValueError("invalid provider configuration")
        if mode == "evaluation" and raw_key:
            raise ValueError("evaluation mode cannot use a commercial credential")
        self._redactor = (
            SecretRedactor(known_secrets=(SecretValue(raw_key),)) if raw_key else SecretRedactor()
        )
        self._http, self._key, self._enabled, self._mode, self._clock = (
            http,
            key,
            enabled,
            mode,
            clock,
        )
        suppress_http_payload_logs()

    async def forecast(self, query: ForecastQuery) -> ForecastResult:
        if not self._enabled or (self._mode == "commercial" and not self._key.get_secret_value()):
            return ForecastResult(status="unavailable")
        params = {
            **query.model_dump(mode="json"),
            "daily": ",".join(DAILY),
            "timezone": "auto",
            "temperature_unit": "celsius",
        }
        host = "customer-api.open-meteo.com" if self._mode == "commercial" else "api.open-meteo.com"
        if self._mode == "commercial":
            params["apikey"] = self._key.get_secret_value()
        try:
            async with (
                asyncio.timeout(8),
                self._http.stream(
                    "GET",
                    f"https://{host}/v1/forecast",
                    params=params,
                    headers={"Accept": "application/json"},
                    timeout=httpx.Timeout(5, connect=3, pool=1),
                    follow_redirects=False,
                ) as response,
            ):
                if (
                    response.status_code != 200
                    or response.headers.get("content-type", "").split(";", 1)[0].strip()
                    != "application/json"
                ):
                    return ForecastResult(status="unavailable")
                raw = bytearray()
                async for chunk in response.aiter_bytes(chunk_size=16384):
                    raw.extend(chunk)
                    if len(raw) > 65536:
                        return ForecastResult(status="unavailable")
            body = json.loads(
                raw,
                parse_float=str,
                parse_constant=reject_constant,
                object_pairs_hook=unique_object,
            )
            pending = [(body, 0)]
            while pending:
                value, depth = pending.pop()
                if depth > 16:
                    return ForecastResult(status="unavailable")
                if isinstance(value, dict | list):
                    if len(value) > 500:
                        return ForecastResult(status="unavailable")
                    pending.extend(
                        (item, depth + 1)
                        for item in (value.values() if isinstance(value, dict) else value)
                    )
            if self._redactor.redact(body) != body:
                return ForecastResult(status="unavailable")
            daily = body["daily"]
            if body["daily_units"] != UNITS:
                return ForecastResult(status="unavailable")
            count = len(daily["time"])
            if not 1 <= count <= query.forecast_days or any(
                len(daily[key]) != count for key in DAILY
            ):
                return ForecastResult(status="unavailable")
            days = tuple(
                ForecastDay(
                    local_date=daily["time"][i],
                    weather_code=daily["weather_code"][i],
                    maximum_celsius=daily["temperature_2m_max"][i],
                    minimum_celsius=daily["temperature_2m_min"][i],
                    precipitation_probability_percent=daily["precipitation_probability_max"][i],
                    uv_index=daily["uv_index_max"][i],
                )
                for i in range(count)
            )
            now = self._clock()
            offset = body.get("utc_offset_seconds", 0)
            if type(offset) is not int or not -43200 <= offset <= 50400:
                return ForecastResult(status="unavailable")
            today = (now + timedelta(seconds=offset)).date()
            if any(
                day.local_date != today + timedelta(days=i)
                or day.minimum_celsius > day.maximum_celsius
                for i, day in enumerate(days)
            ):
                return ForecastResult(status="unavailable")
            return ForecastResult(
                status="ok", observed_at=now.isoformat(), timezone=body["timezone"], days=days
            )
        except httpx.HTTPError, TimeoutError, ValueError, RecursionError, KeyError, TypeError:
            return ForecastResult(status="unavailable")
