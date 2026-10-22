import asyncio
import json
import logging

import httpx
from pydantic import SecretStr, TypeAdapter
from tesserix_mcp_runtime import JsonValue, SecretRedactor, SecretValue

from expedia_recommendations_mcp.contracts import MAX_DATA_CHARS, Category, Query, Result

MAX_RESPONSE_BYTES = 65536
JSON = TypeAdapter(JsonValue)
KEYWORDS: dict[Category, str] = {
    "hotels": "Hotels|MCP",
    "flights": "Flights|MCP",
    "activities": "Activities|MCP",
    "cars": "CarRental|MCP",
}


def suppress_http_payload_logs() -> None:
    # HTTP library logs can include URLs carrying traveller queries.
    for name in ("httpx", "httpcore"):
        logger = logging.getLogger(name)
        logger.handlers = [logging.NullHandler()]
        logger.propagate = False


def unique_object(pairs: list[tuple[str, JsonValue]]) -> dict[str, JsonValue]:
    result: dict[str, JsonValue] = {}
    for name, value in pairs:
        if name in result:
            raise ValueError("duplicate response property")
        result[name] = value
    return result


def reject_constant(value: str) -> None:
    raise ValueError("nonfinite response number")


class ExpediaClient:
    def __init__(self, http: httpx.AsyncClient, *, key: SecretStr, enabled: bool = False) -> None:
        raw_key = key.get_secret_value()
        if len(raw_key) > 4096 or any(not 32 <= ord(c) < 127 for c in raw_key):
            raise ValueError("invalid provider credential")
        self._http = http
        self._key = key
        self._enabled = enabled
        self._redactor = (
            SecretRedactor(known_secrets=(SecretValue(raw_key),)) if raw_key else SecretRedactor()
        )
        suppress_http_payload_logs()

    async def search(self, category: Category, query: Query) -> Result:
        if not self._enabled or not self._key.get_secret_value():
            return Result(status="unavailable")
        params = query.model_dump(mode="json", exclude_none=True)
        params["user_input_in_english"] = params.pop("query_text")
        params["keywords"] = KEYWORDS[category]
        try:
            async with (
                asyncio.timeout(8),
                self._http.stream(
                    "GET",
                    f"https://apim.expedia.com/recommendations/{category}",
                    params=params,
                    headers={
                        "X-API-KEY": self._key.get_secret_value(),
                        "Accept": "application/json",
                    },
                    timeout=httpx.Timeout(5, connect=3, pool=1),
                    follow_redirects=False,
                ) as response,
            ):
                if (
                    response.status_code != 200
                    or response.headers.get("content-type", "").split(";", 1)[0].strip()
                    != "application/json"
                ):
                    return Result(status="unavailable")
                raw = bytearray()
                async for part in response.aiter_bytes(chunk_size=16384):
                    raw.extend(part)
                    if len(raw) > MAX_RESPONSE_BYTES:
                        return Result(status="unavailable")
            data = JSON.validate_python(
                json.loads(
                    raw,
                    parse_float=str,
                    parse_constant=reject_constant,
                    object_pairs_hook=unique_object,
                )
            )
            if not isinstance(data, dict | list):
                return Result(status="unavailable")
            if len(json.dumps(data, separators=(",", ":"), ensure_ascii=False)) > MAX_DATA_CHARS:
                return Result(status="unavailable")
            pending: list[tuple[JsonValue, int]] = [(data, 0)]
            while pending:
                value, depth = pending.pop()
                if depth > 16:
                    return Result(status="unavailable")
                if isinstance(value, dict | list):
                    if len(value) > 500:
                        return Result(status="unavailable")
                    pending.extend(
                        (item, depth + 1)
                        for item in (value.values() if isinstance(value, dict) else value)
                    )
            redacted = self._redactor.redact(data)
            if redacted != data:
                return Result(status="unavailable")
            return Result(status="ok", data=data)
        except httpx.HTTPError, TimeoutError, ValueError, RecursionError:
            return Result(status="unavailable")
