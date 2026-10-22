import asyncio

import pytest
from pydantic import SecretStr
from tesserix_mcp_runtime.adapters.streamable_http import (
    HTTPRequestAuthenticationError,
    HTTPRequestMetadata,
)

from expedia_recommendations_mcp.main import GatewayContext, Settings


class NeverCancelled:
    @property
    def cancelled(self) -> bool:
        return False

    async def wait(self) -> None:
        await asyncio.Future()


KEY = "local-test-gateway-key-not-real-1234567890"


@pytest.mark.parametrize(
    "headers,peer",
    [
        ((), "127.0.0.1"),
        ((("X-MCP-Key", "wrong"),), "127.0.0.1"),
        ((("X-MCP-Key", KEY), ("X-MCP-Key", KEY)), "127.0.0.1"),
        ((("X-MCP-Key", KEY),), "192.0.2.1"),
        ((("X-MCP-Key", "☃"),), "127.0.0.1"),
    ],
)
async def test_gateway_context_rejects_wrong_duplicate_or_untrusted_credentials(
    headers: tuple[tuple[str, str], ...], peer: str
) -> None:
    provider = GatewayContext(key=SecretStr(KEY), trusted_cidrs=("127.0.0.1/32",))
    with pytest.raises(HTTPRequestAuthenticationError):
        await provider.create(
            HTTPRequestMetadata(method="POST", path="/mcp", headers=headers, peer_host=peer),
            cancellation=NeverCancelled(),
        )


async def test_unsigned_headers_cannot_change_the_service_authorization() -> None:
    provider = GatewayContext(key=SecretStr(KEY), trusted_cidrs=("127.0.0.1/32",))
    context = await provider.create(
        HTTPRequestMetadata(
            method="POST",
            path="/mcp",
            peer_host="127.0.0.1",
            headers=(("X-MCP-Key", KEY), ("X-Tenant-Id", "other"), ("X-JWT-Claim-Scope", "admin")),
        ),
        cancellation=NeverCancelled(),
    )
    assert context.tenant == "roamie"
    assert context.scopes == ("travel:recommendations:read",)


def test_enabled_provider_requires_real_configuration() -> None:
    with pytest.raises(ValueError):
        Settings(gateway_key=SecretStr(KEY), enabled=True, api_key=SecretStr(""))


@pytest.mark.parametrize("credential", ["short", "x" * 31, "x" * 257, "x" * 32 + "\n"])
def test_weak_or_invalid_gateway_credentials_are_rejected(credential: str) -> None:
    with pytest.raises(ValueError):
        GatewayContext(key=SecretStr(credential), trusted_cidrs=("127.0.0.1/32",))
