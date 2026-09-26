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


async def test_trip_planning_searches_destination_without_current_location():
    import httpx

    from roamie_travel_mcp.nearby import NearbyProvider

    def reply(request):
        assert request.url.path == "/internal/v1/travel/planning"
        assert request.url.params["destination"] == "Hanoi"
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
                        "prompt": "Three options",
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
