import httpx
from pydantic import SecretStr
from tesserix_mcp_runtime import AuthenticatedIdentity, CallContext
from tesserix_mcp_runtime.adapters.in_process import InProcessTransport

from expedia_recommendations_mcp.client import ExpediaClient
from expedia_recommendations_mcp.server import application, catalog


async def test_only_four_read_recommendation_tools_are_published() -> None:
    async with httpx.AsyncClient() as http:
        tools = catalog(ExpediaClient(http, key=SecretStr("")))
        assert {tool.metadata.name for tool in tools.manifests} == {
            "get_hotel_recommendations",
            "get_flight_recommendations",
            "get_activity_recommendations",
            "get_car_recommendations",
        }
        assert all(tool.metadata.effect.value == "read" for tool in tools.manifests)


async def test_other_tenant_cannot_invoke_a_recommendation() -> None:
    def upstream(request: httpx.Request) -> httpx.Response:
        raise AssertionError("unauthorized caller reached upstream")

    async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as http:
        transport = InProcessTransport()
        app = application(
            transport=transport,
            client=ExpediaClient(http, key=SecretStr("dummy-key"), enabled=True),
        )
        await app.start()
        try:
            result = await transport.invoke(
                "get_hotel_recommendations",
                {"destination": "Paris"},
                context=CallContext(
                    identity=AuthenticatedIdentity(
                        tenant="other",
                        subject="gateway",
                        issuer="https://identity.example.org",
                        scopes=("travel:recommendations:read",),
                    ),
                    request_id="test",
                    run_id="test",
                ),
            )
            assert result.error is not None
            assert result.error.code.value == "forbidden"
            assert result.value is None
        finally:
            await app.drain()
            await app.stop()
