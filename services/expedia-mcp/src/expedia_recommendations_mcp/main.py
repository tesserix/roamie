import asyncio
import hmac
import ipaddress
import secrets
import signal
import sys
import time
from typing import Self

import httpx
from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from tesserix_mcp_runtime import (
    AuthenticatedIdentity,
    CallContext,
    Cancellation,
    SecretRedactor,
    SecretValue,
)
from tesserix_mcp_runtime.adapters.streamable_http import (
    HTTPRequestAuthenticationError,
    HTTPRequestMetadata,
    StreamableHTTPConfig,
    StreamableHTTPLimits,
    StreamableHTTPTransport,
)

from expedia_recommendations_mcp.client import ExpediaClient, suppress_http_payload_logs
from expedia_recommendations_mcp.server import Telemetry, application


def gateway_credential(value: SecretStr) -> SecretStr:
    raw = value.get_secret_value()
    if not 32 <= len(raw) <= 256 or any(not 33 <= ord(c) < 127 for c in raw):
        raise ValueError("invalid gateway credential")
    return value


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="EXPEDIA_MCP_", frozen=True, extra="forbid", populate_by_name=True
    )
    gateway_key: SecretStr
    api_key: SecretStr = Field(default=SecretStr(""), validation_alias="EXPEDIA_API_KEY")
    enabled: bool = False
    host: str = "127.0.0.1"
    port: int = Field(default=8080, ge=1, le=65535)
    allowed_hosts: str = "localhost,127.0.0.1"
    allowed_origins: str = "http://localhost"
    gateway_cidrs: str = "127.0.0.1/32"

    @field_validator("gateway_key")
    @classmethod
    def validate_key(cls, value: SecretStr) -> SecretStr:
        return gateway_credential(value)

    @model_validator(mode="after")
    def active_provider_has_key(self) -> Self:
        if self.enabled and not self.api_key.get_secret_value().strip():
            raise ValueError("enabled provider requires a credential")
        return self


class GatewayContext:
    def __init__(self, *, key: SecretStr, trusted_cidrs: tuple[str, ...]) -> None:
        self._key = gateway_credential(key)
        if not 1 <= len(trusted_cidrs) <= 8:
            raise ValueError("explicit trusted gateway networks required")
        self._networks = tuple(ipaddress.ip_network(cidr) for cidr in trusted_cidrs)
        if any(network.prefixlen == 0 for network in self._networks):
            raise ValueError("wildcard gateway networks forbidden")

    async def create(
        self, request: HTTPRequestMetadata, *, cancellation: Cancellation
    ) -> CallContext:
        request_id = secrets.token_hex(16)
        try:
            peer = ipaddress.ip_address(request.peer_host or "")
            values = request.header_values("X-MCP-Key")
            if (
                not any(peer in network for network in self._networks)
                or len(values) != 1
                or not hmac.compare_digest(
                    values[0].encode(), self._key.get_secret_value().encode()
                )
            ):
                raise ValueError("rejected gateway")
        except ValueError:
            raise HTTPRequestAuthenticationError(request_id=request_id) from None
        return CallContext(
            identity=AuthenticatedIdentity(
                tenant="roamie",
                subject="agentgateway",
                issuer="urn:tesserix:service-key",
                scopes=("travel:recommendations:read",),
            ),
            request_id=request_id,
            run_id=request_id,
            deadline=time.monotonic() + 10,
            cancellation=cancellation,
        )


def http_config(settings: Settings) -> StreamableHTTPConfig:
    hosts = tuple(host.strip() for host in settings.allowed_hosts.split(","))
    authorities = tuple(f"{host}:{settings.port}" for host in hosts if ":" not in host)
    return StreamableHTTPConfig(
        host=settings.host,
        port=settings.port,
        allowed_hosts=hosts + authorities,
        allowed_origins=tuple(settings.allowed_origins.split(",")),
    )


async def serve() -> None:
    settings = Settings.model_validate({})
    suppress_http_payload_logs()
    provider = GatewayContext(
        key=settings.gateway_key, trusted_cidrs=tuple(settings.gateway_cidrs.split(","))
    )
    redactor = SecretRedactor(
        known_secrets=tuple(
            SecretValue(key.get_secret_value())
            for key in (settings.gateway_key, settings.api_key)
            if key.get_secret_value()
        )
    )
    transport = StreamableHTTPTransport(
        config=http_config(settings),
        limits=StreamableHTTPLimits(
            max_tools=4,
            tool_page_size=4,
            max_tool_pages=1,
            max_request_body_bytes=8192,
            max_response_body_bytes=262144,
            max_stream_seconds=15,
        ),
        context_provider=provider,
        telemetry=Telemetry(),
        redactor=redactor,
    )
    async with httpx.AsyncClient(
        timeout=5,
        trust_env=False,
        follow_redirects=False,
        limits=httpx.Limits(max_connections=16, max_keepalive_connections=8),
    ) as http:
        app = application(
            transport=transport,
            client=ExpediaClient(http, key=settings.api_key, enabled=settings.enabled),
        )
        stop = asyncio.Event()
        for received in (signal.SIGINT, signal.SIGTERM):
            asyncio.get_running_loop().add_signal_handler(received, stop.set)
        await app.start()
        try:
            await stop.wait()
        finally:
            await app.drain()
            await app.stop()


def main() -> None:
    try:
        asyncio.run(serve())
    except Exception:
        print("Expedia MCP startup or runtime failure; details withheld.", file=sys.stderr)
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
