import json

import httpx
from asgi_lifespan import LifespanManager
from pydantic import SecretStr
from tesserix_mcp_runtime.adapters.streamable_http import (
    ASGIApplication,
    StreamableHTTPLimits,
    StreamableHTTPTransport,
)

from open_meteo_mcp.client import OpenMeteoClient
from open_meteo_mcp.main import GatewayContext, Settings, http_config
from open_meteo_mcp.server import Telemetry, application

KEY = "local-test-gateway-key-not-real-1234567890"


class MemoryListener:
    bound_port = 8080
    app: ASGIApplication
    manager: LifespanManager

    async def start(self, app: ASGIApplication, *, startup_timeout: float) -> None:
        self.app = app
        self.manager = LifespanManager(app)
        await self.manager.__aenter__()

    async def stop(self) -> None:
        await self.manager.__aexit__(None, None, None)


async def test_native_http_initialization_discovery_and_denial() -> None:
    listener = MemoryListener()
    transport = StreamableHTTPTransport(
        config=http_config(Settings(gateway_key=SecretStr(KEY))),
        limits=StreamableHTTPLimits(
            max_tools=4, tool_page_size=4, max_tool_pages=1, max_request_body_bytes=8192
        ),
        context_provider=GatewayContext(key=SecretStr(KEY), trusted_cidrs=("127.0.0.1/32",)),
        listener=listener,
        telemetry=Telemetry(),
    )
    async with httpx.AsyncClient() as provider_http:
        app = application(
            transport=transport, client=OpenMeteoClient(provider_http, key=SecretStr(""))
        )
        await app.start()
        try:
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=listener.app),
                base_url="http://127.0.0.1:8080",
                headers={
                    "Accept": "application/json, text/event-stream",
                    "Content-Type": "application/json",
                },
            ) as client:
                assert (await client.get("/livez")).status_code == 200
                message = {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "protocolVersion": "2026-07-28",
                        "capabilities": {},
                        "clientInfo": {"name": "test", "version": "1"},
                    },
                }
                denied = await client.post("/mcp", json=message)
                assert denied.status_code in {401, 403, 404}
                client.headers["X-MCP-Key"] = KEY
                initialized = await client.post("/mcp", json=message)
                assert initialized.status_code == 200, initialized.text
                if "Mcp-Session-Id" in initialized.headers:
                    client.headers["Mcp-Session-Id"] = initialized.headers["Mcp-Session-Id"]
                client.headers["MCP-Protocol-Version"] = "2026-07-28"
                notified = await client.post(
                    "/mcp", json={"jsonrpc": "2.0", "method": "notifications/initialized"}
                )
                assert notified.status_code in {200, 202, 204}, notified.text
                discovered = await client.post(
                    "/mcp",
                    headers={"MCP-Method": "tools/list"},
                    json={
                        "jsonrpc": "2.0",
                        "id": 2,
                        "method": "tools/list",
                        "params": {
                            "_meta": {
                                "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                                "io.modelcontextprotocol/clientCapabilities": {},
                            }
                        },
                    },
                )
                assert discovered.status_code == 200, discovered.text
                body = discovered.text
                if body.startswith("event:"):
                    body = next(line[6:] for line in body.splitlines() if line.startswith("data: "))
                assert {tool["name"] for tool in json.loads(body)["result"]["tools"]} == {
                    "get_weather_forecast",
                }
                rejected = await client.post("/mcp", content=b"x" * 8193)
                assert rejected.status_code == 413
                rejected_host = await client.post(
                    "/mcp", json=message, headers={"Host": "evil.example"}
                )
                assert rejected_host.status_code in {400, 403, 421}
        finally:
            await app.drain()
            await app.stop()
