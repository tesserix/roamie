import hashlib
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
        planning = specialist == "trip-planner" and isinstance(request.get("destination"), str)
        stays = request.get("stays")
        if planning and isinstance(stays, list) and stays:
            combined: list[JsonValue] = []
            for stay in stays:
                if not isinstance(stay, dict):
                    return {"status": "unavailable", "facts": []}
                result = await self.search(
                    {
                        "specialist": specialist,
                        "request": {**request, "stays": [], "destination": stay["destination"]},
                    },
                    context=context,
                )
                if not isinstance(result, dict) or result.get("status") != "ok":
                    return {"status": "unavailable", "facts": []}
                items = result.get("facts")
                if not isinstance(items, list):
                    return {"status": "unavailable", "facts": []}
                for kind in ("activities", "trip-planner", "food"):
                    combined.extend(
                        [
                            item
                            for item in items
                            if isinstance(item, dict) and item.get("category") == kind
                        ][:3]
                    )
            return {
                "status": "ok",
                "facts": list(
                    {str(item["id"]): item for item in combined if isinstance(item, dict)}.values()
                ),
            }
        if not planning and not isinstance(origin, dict):
            return {"status": "unavailable", "facts": []}
        if planning:
            path = "/internal/v1/travel/planning"
            params = {"destination": str(request["destination"])}
        else:
            if not isinstance(origin, dict):
                return {"status": "unavailable", "facts": []}
            path = "/internal/v1/travel/nearby"
            params = {
                "lat": str(origin["latitude"]),
                "lng": str(origin["longitude"]),
                "kind": "food" if specialist == "food" else "sights",
            }
        try:
            async with self._client.stream(
                "GET",
                path,
                params=params,
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
            if planning:
                selected: dict[str, JsonValue] = {}
                for kind in ("activities", "accommodation", "food"):
                    for place in [item for item in places if item.get("kind") == kind][:8]:
                        selected[place["id"]] = {
                            "id": hashlib.sha256(str(request["destination"]).encode()).hexdigest()[
                                :8
                            ]
                            + ":"
                            + place["id"],
                            "name": place["name"],
                            "category": "trip-planner" if kind == "accommodation" else kind,
                            "destination": str(request["destination"]),
                            "place_kind": "accommodation" if kind == "accommodation" else "place",
                            "source_url": place["mapsUri"],
                            "observed_at": datetime.now(UTC).isoformat(),
                            "location": {"latitude": place["lat"], "longitude": place["lng"]},
                        }
                return {
                    "status": "ok",
                    "facts": list(selected.values()),
                }
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
