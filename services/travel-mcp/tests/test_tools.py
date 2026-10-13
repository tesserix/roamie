import pytest
from tesserix_mcp_runtime import AuthenticatedIdentity, CallContext
from tesserix_mcp_runtime.adapters.in_process import InProcessTransport

from roamie_travel_mcp.server import build_application


async def test_missing_provider_returns_explicit_unavailable_through_runtime():
    transport = InProcessTransport()
    application = build_application(transport=transport)
    await application.start()
    try:
        result = await transport.invoke(
            "travel_search",
            {
                "specialist": "activities",
                "request": {"prompt": "Museum"},
            },
            context=CallContext(
                identity=AuthenticatedIdentity(
                    tenant="roamie",
                    subject="customer-1",
                    issuer="https://identity.example.org",
                    scopes=("roamie:travel:read",),
                ),
                request_id="test-request",
                run_id="test-run",
            ),
        )
        assert result.error is None
        assert result.value == {"status": "unavailable", "facts": []}
    finally:
        await application.drain()
        await application.stop()


async def test_other_tenant_and_missing_scope_are_denied():
    transport = InProcessTransport()
    application = build_application(transport=transport)
    await application.start()
    try:
        for tenant, scopes in (("other", ("roamie:travel:read",)), ("roamie", ())):
            result = await transport.invoke(
                "travel_search",
                {
                    "specialist": "food",
                    "request": {"prompt": "Dinner"},
                },
                context=CallContext(
                    identity=AuthenticatedIdentity(
                        tenant=tenant,
                        subject="customer",
                        issuer="https://identity.example.org",
                        scopes=scopes,
                    ),
                    request_id="request",
                    run_id="run",
                ),
            )
            assert result.error is not None
            assert result.value is None
    finally:
        await application.drain()
        await application.stop()


async def test_real_roamie_nearby_contract_preserves_unknown_prices():
    import httpx

    from roamie_travel_mcp.nearby import NearbyProvider

    def reply(request):
        assert request.url.path == "/internal/v1/travel/nearby"
        assert request.url.params["kind"] == "food"
        return httpx.Response(
            200,
            json={
                "places": [
                    {
                        "id": "place-1",
                        "name": "Cafe",
                        "mapsUri": "https://maps.google.com/place",
                        "lat": -37.81,
                        "lng": 144.96,
                        "distanceM": 100,
                        "servesVegetarian": True,
                    }
                ]
            },
        )

    async with httpx.AsyncClient(
        base_url="https://roamie.example.org", transport=httpx.MockTransport(reply)
    ) as client:
        transport = InProcessTransport()
        application = build_application(transport=transport, provider=NearbyProvider(client))
        await application.start()
        try:
            result = await transport.invoke(
                "travel_search",
                {
                    "specialist": "food",
                    "request": {
                        "prompt": "Dinner",
                        "origin": {
                            "latitude": -37.81,
                            "longitude": 144.96,
                        },
                    },
                },
                context=CallContext(
                    identity=AuthenticatedIdentity(
                        tenant="roamie",
                        subject="customer",
                        issuer="https://identity.example.org",
                        scopes=("roamie:travel:read",),
                    ),
                    request_id="request",
                    run_id="run",
                ),
            )
            assert result.error is None
            assert result.value["facts"][0]["dietary_tags"] == ["vegetarian"]
            assert "cost_minor" not in result.value["facts"][0]
            assert "duration_seconds" not in result.value["facts"][0]
        finally:
            await application.drain()
            await application.stop()


@pytest.mark.parametrize(
    ("prompt", "preferences", "interests"),
    [
        ("Culture and gardens", ["relaxed pace"], "Culture and gardens; relaxed pace"),
        (
            "Plan Hanoi for 2 travellers. Culture and gardens",
            ["Party: 2 travellers; 2 adults; children 0; luggage 0", "Culture and gardens"],
            "Culture and gardens",
        ),
        (
            "Plan Hanoi for 1 traveller.  Culture and gardens",
            ["culture and gardens"],
            "Culture and gardens",
        ),
    ],
)
async def test_trip_planning_searches_destination_without_current_location(
    prompt, preferences, interests
):
    import httpx

    from roamie_travel_mcp.nearby import NearbyProvider

    def reply(request):
        assert request.url.path == "/internal/v1/travel/planning"
        assert request.url.params["destination"] == "Hanoi"
        assert request.url.params["interests"] == interests
        return httpx.Response(
            200,
            json={
                "places": [
                    {
                        "id": "hotel",
                        "name": "Hotel",
                        "mapsUri": "https://maps.google.com/hotel",
                        "lat": 21.0,
                        "lng": 105.0,
                        "kind": "accommodation",
                    }
                ]
            },
        )

    async with httpx.AsyncClient(
        base_url="https://roamie.example.org", transport=httpx.MockTransport(reply)
    ) as client:
        transport = InProcessTransport()
        application = build_application(transport=transport, provider=NearbyProvider(client))
        await application.start()
        try:
            result = await transport.invoke(
                "travel_search",
                {
                    "specialist": "trip-planner",
                    "request": {
                        "prompt": prompt,
                        "preferences": preferences,
                        "destination": "Hanoi",
                        "plan_options": True,
                    },
                },
                context=CallContext(
                    identity=AuthenticatedIdentity(
                        tenant="roamie",
                        subject="manager",
                        issuer="https://identity.example.org",
                        scopes=("roamie:travel:read",),
                    ),
                    request_id="request",
                    run_id="run",
                ),
            )
            assert result.error is None
            assert result.value["status"] == "ok"
            assert result.value["facts"][0]["place_kind"] == "accommodation"
            assert "cost_minor" not in result.value["facts"][0]
        finally:
            await application.drain()
            await application.stop()


@pytest.mark.parametrize("cities, per_category", [(1, 8), (2, 3), (3, 3), (4, 3)])
async def test_stays_preserve_place_variety_within_the_evidence_limit(cities, per_category):
    import httpx

    from roamie_travel_mcp.nearby import NearbyProvider

    places = [
        {
            "id": f"{kind}-{index}",
            "name": f"{kind} {index}",
            "mapsUri": f"https://maps.google.com/{kind}-{index}",
            "lat": 35.0,
            "lng": 139.0,
            "kind": kind,
        }
        for kind in ("activities", "accommodation", "food")
        for index in range(8)
    ]
    async with httpx.AsyncClient(
        base_url="https://roamie.example.org",
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"places": places})),
    ) as client:
        result = await NearbyProvider(client).search(
            {
                "specialist": "trip-planner",
                "request": {
                    "destination": "Tokyo",
                    "stays": [{"destination": f"City {i}", "days": 2} for i in range(cities)],
                },
            },
            context=CallContext(
                identity=AuthenticatedIdentity(
                    tenant="roamie",
                    subject="manager",
                    issuer="https://identity.example.org",
                    scopes=("roamie:travel:read",),
                ),
                request_id="test",
                run_id="test",
            ),
        )
    assert result["status"] == "ok"
    assert len(result["facts"]) == cities * per_category * 3
    assert len(result["facts"]) <= 40
    assert (
        len([fact for fact in result["facts"] if fact["category"] == "activities"])
        == cities * per_category
    )
    for i in range(cities):
        assert (
            len([f for f in result["facts"] if f["destination"] == f"City {i}"]) == per_category * 3
        )
