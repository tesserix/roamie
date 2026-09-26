from collections.abc import Mapping
from datetime import UTC, datetime

import httpx
from tesserix_mcp_runtime import CallContext, JsonValue


class NearbyProvider:
    def __init__(self, client: httpx.AsyncClient) -> None:
        self._client = client

    async def search(
        self, arguments: Mapping[str, JsonValue], *, context: CallContext
    ) -> JsonValue:
        specialist = arguments.get("specialist")
        request = arguments.get("request")
        if specialist not in ("food", "activities", "trip-planner") or not isinstance(
            request, dict
        ):
            return {"status": "unavailable", "facts": []}
        origin = request.get("origin")
        if not isinstance(origin, dict):
            return {"status": "unavailable", "facts": []}
        try:
            async with self._client.stream(
                "GET",
                "/internal/v1/travel/nearby",
                params={
                    "lat": str(origin["latitude"]),
                    "lng": str(origin["longitude"]),
                    "kind": "food" if specialist == "food" else "sights",
                },
            ) as response:
                response.raise_for_status()
                payload = bytearray()
                async for chunk in response.aiter_bytes():
                    payload.extend(chunk)
                    if len(payload) > 65536:
                        return {"status": "unavailable", "facts": []}
            import json

            body = json.loads(payload)
            places = body.get("places")
            if not isinstance(places, list) or len(places) > 40:
                return {"status": "unavailable", "facts": []}
            facts: list[JsonValue] = []
            for place in places:
                if place.get("openNow") is False:
                    continue
                facts.append(
                    {
                        "id": place["id"],
                        "name": place["name"],
                        "category": "food" if specialist == "food" else "activities",
                        "source_url": place["mapsUri"],
                        "observed_at": datetime.now(UTC).isoformat(),
                        "location": {"latitude": place["lat"], "longitude": place["lng"]},
                        "distance_metres": place["distanceM"],
                        "dietary_tags": ["vegetarian"]
                        if place.get("servesVegetarian") is True
                        else [],
                    }
                )
            return {"status": "ok", "facts": facts}
        except httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError:
            return {"status": "unavailable", "facts": []}
