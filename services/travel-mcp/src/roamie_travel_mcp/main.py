import asyncio
import hmac
import os
import signal

import httpx
from tesserix_mcp_runtime import CallContext, Cancellation, SecretRedactor, SecretValue
from tesserix_mcp_runtime.adapters.gateway_identity import (
    GatewayIdentityConfig,
)
from tesserix_mcp_runtime.adapters.streamable_http import (
    HTTPCallContextProvider,
    HTTPRequestAuthenticationError,
    HTTPRequestMetadata,
    StreamableHTTPConfig,
    StreamableHTTPLimits,
    StreamableHTTPTransport,
)

from roamie_travel_mcp.identity import ZitadelContext
from roamie_travel_mcp.nearby import NearbyProvider
from roamie_travel_mcp.server import SafeTelemetry, build_application


class GatewayContext:
    def __init__(self, *, key: str, verifier: HTTPCallContextProvider) -> None:
        if len(key) < 32:
            raise ValueError("MCP upstream key must contain at least 32 characters")
        self._key = key
        self._verifier = verifier

    async def create(
        self, request: HTTPRequestMetadata, *, cancellation: Cancellation
    ) -> CallContext:
        values = request.header_values("X-MCP-Key")
        if len(values) != 1 or not hmac.compare_digest(values[0], self._key):
            raise HTTPRequestAuthenticationError(request_id="rejected")
        context = await self._verifier.create(request, cancellation=cancellation)
        if context.tenant != "roamie":
            raise HTTPRequestAuthenticationError(request_id=context.request_id)
        return context


async def serve() -> None:
    upstream_key = os.environ["ROAMIE_MCP_KEY"]
    verifier = ZitadelContext(
        GatewayIdentityConfig(
            issuer=os.environ["ROAMIE_MCP_ISSUER"],
            audience=os.environ["ROAMIE_MCP_AUDIENCE"],
            jwks_url=os.environ["ROAMIE_MCP_JWKS_URL"],
            jwks_allowed_hosts=tuple(os.environ["ROAMIE_MCP_JWKS_HOSTS"].split(",")),
            trusted_proxy_cidrs=tuple(os.environ["ROAMIE_MCP_GATEWAY_CIDRS"].split(",")),
        ),
        manager_subject=os.environ["ROAMIE_MCP_MANAGER_SUBJECT"],
        organization=os.environ["ROAMIE_MCP_ORGANIZATION"],
    )
    transport = StreamableHTTPTransport(
        config=StreamableHTTPConfig(
            host=os.environ.get("ROAMIE_MCP_LISTEN_HOST", "127.0.0.1"),
            port=8080,
            allowed_hosts=tuple(os.environ["ROAMIE_MCP_ALLOWED_HOSTS"].split(",")),
            allowed_origins=tuple(os.environ["ROAMIE_MCP_ALLOWED_ORIGINS"].split(",")),
        ),
        limits=StreamableHTTPLimits(max_tools=1, tool_page_size=1, max_tool_pages=1),
        context_provider=GatewayContext(key=upstream_key, verifier=verifier),
        telemetry=SafeTelemetry(),
        redactor=SecretRedactor(known_secrets=(SecretValue(upstream_key),)),
    )
    async with httpx.AsyncClient(
        base_url=os.environ["ROAMIE_MCP_API_ORIGIN"],
        timeout=5,
        trust_env=False,
        follow_redirects=False,
        headers={"Authorization": "Bearer " + os.environ["ROAMIE_MCP_API_TOKEN"]},
    ) as client:
        application = build_application(transport=transport, provider=NearbyProvider(client))
        stopping = asyncio.Event()
        for received in (signal.SIGINT, signal.SIGTERM):
            asyncio.get_running_loop().add_signal_handler(received, stopping.set)
        await application.start()
        try:
            await stopping.wait()
        finally:
            await application.drain()
            await application.stop()


if __name__ == "__main__":
    asyncio.run(serve())
