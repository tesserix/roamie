import httpx
from pydantic import SecretStr
from tesserix_mcp_runtime import AuthenticatedIdentity, CallContext
from tesserix_mcp_runtime.adapters.in_process import InProcessTransport

from open_meteo_mcp.client import OpenMeteoClient
from open_meteo_mcp.server import application, catalog


async def test_only_one_read_forecast_tool_are_published() -> None:
    async with httpx.AsyncClient() as http:
        tools = catalog(OpenMeteoClient(http, key=SecretStr("")))
        assert {tool.metadata.name for tool in tools.manifests} == {
            "get_weather_forecast",
        }
        assert all(tool.metadata.effect.value == "read" for tool in tools.manifests)


async def test_other_tenant_cannot_invoke_a_forecast() -> None:
    def upstream(request: httpx.Request) -> httpx.Response:
        raise AssertionError("unauthorized caller reached upstream")

    async with httpx.AsyncClient(transport=httpx.MockTransport(upstream)) as http:
        transport = InProcessTransport()
        app = application(
            transport=transport,
            client=OpenMeteoClient(http, key=SecretStr("dummy-key"), enabled=True),
        )
        await app.start()
        try:
            result = await transport.invoke(
                "get_weather_forecast",
                {"latitude": 0.0, "longitude": 0.0},
                context=CallContext(
                    identity=AuthenticatedIdentity(
                        tenant="other",
                        subject="gateway",
                        issuer="https://identity.example.org",
                        scopes=("weather:forecast:read",),
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


async def test_allowed_forecast_call_returns_attributed_bounded_measurements():
    from datetime import UTC, datetime

    from test_client import provider_payload

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda req: httpx.Response(200, json=provider_payload()))
    ) as http:
        transport = InProcessTransport()
        app = application(
            transport=transport,
            client=OpenMeteoClient(
                http,
                mode="evaluation",
                enabled=True,
                clock=lambda: datetime(2026, 10, 12, 20, tzinfo=UTC),
            ),
        )
        await app.start()
        try:
            result = await transport.invoke(
                "get_weather_forecast",
                {"latitude": -37.8, "longitude": 145.0, "forecast_days": 1},
                context=CallContext(
                    identity=AuthenticatedIdentity(
                        tenant="roamie",
                        subject="gateway",
                        issuer="urn:test",
                        scopes=("weather:forecast:read",),
                    ),
                    request_id="qa",
                    run_id="qa",
                ),
            )
            assert result.error is None
            assert result.value["status"] == "ok"
            assert result.value["attribution"] == "Weather data by Open-Meteo (CC BY 4.0)"
            assert result.value["days"][0]["maximum_celsius"] == "23.2"
        finally:
            await app.drain()
            await app.stop()
