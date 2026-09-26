import asyncio
import ipaddress
import secrets
import time
from collections.abc import Callable
from typing import Any

import jwt
from tesserix_mcp_runtime import AuthenticatedIdentity, CallContext, Cancellation
from tesserix_mcp_runtime.adapters.gateway_identity import (
    GatewayIdentityConfig,
    HTTPSJWKSFetcher,
    JWKSFetcher,
)
from tesserix_mcp_runtime.adapters.streamable_http import (
    HTTPRequestAuthenticationError,
    HTTPRequestMetadata,
)


class ZitadelContext:
    def __init__(
        self,
        config: GatewayIdentityConfig,
        *,
        manager_subject: str,
        organization: str,
        fetcher: JWKSFetcher | None = None,
        clock: Callable[[], float] = time.time,
    ) -> None:
        if not manager_subject or not organization:
            raise ValueError("manager subject and organization are required")
        self._config = config
        self._subject = manager_subject
        self._organization = organization
        self._fetcher = fetcher or HTTPSJWKSFetcher(config)
        self._clock = clock
        self._peers = tuple(ipaddress.ip_network(value) for value in config.trusted_proxy_cidrs)
        self._keys: dict[str, jwt.PyJWK] = {}
        self._expires = 0.0
        self._retry_after = 0.0
        self._lock = asyncio.Lock()

    async def _key(self, kid: str) -> jwt.PyJWK:
        async with self._lock:
            now = self._clock()
            if now < self._expires and kid in self._keys:
                return self._keys[kid]
            if now < self._retry_after:
                raise ValueError("key unavailable")
            self._retry_after = now + 5
            document = await self._fetcher.fetch()
            values = document.get("keys")
            if not isinstance(values, list) or not 1 <= len(values) <= self._config.max_jwks_keys:
                raise ValueError("invalid keys")
            keys = {}
            for value in values:
                if (
                    not isinstance(value, dict)
                    or value.get("kty") != "RSA"
                    or value.get("use", "sig") != "sig"
                    or value.get("alg", "RS256") != "RS256"
                ):
                    continue
                identifier = value.get("kid")
                if (
                    not isinstance(identifier, str)
                    or not 1 <= len(identifier) <= 200
                    or identifier in keys
                ):
                    raise ValueError("ambiguous keys")
                keys[identifier] = jwt.PyJWK.from_dict(value, algorithm="RS256")
            self._keys = keys
            self._expires = now + self._config.jwks_fresh_seconds
            if kid not in keys:
                raise ValueError("unknown key")
            return keys[kid]

    async def create(
        self, request: HTTPRequestMetadata, *, cancellation: Cancellation
    ) -> CallContext:
        request_id = secrets.token_hex(16)
        try:
            peer = ipaddress.ip_address(request.peer_host or "")
            if not any(peer in network for network in self._peers):
                raise ValueError("untrusted peer")
            authorization = request.header_values("Authorization")
            if (
                len(authorization) != 1
                or not authorization[0].startswith("Bearer ")
                or len(authorization[0]) > 16384
            ):
                raise ValueError("invalid authorization")
            token = authorization[0][7:]
            header = jwt.get_unverified_header(token)
            kid = header.get("kid")
            if header.get("alg") != "RS256" or not isinstance(kid, str) or not 1 <= len(kid) <= 200:
                raise ValueError("invalid key identifier")
            key = await self._key(kid)
            claims: dict[str, Any] = jwt.decode(
                token,
                key.key,
                algorithms=["RS256"],
                issuer=self._config.issuer,
                audience=self._config.audience,
                options={
                    "require": ["iss", "aud", "sub", "iat", "exp"],
                    "verify_exp": False,
                    "verify_iat": False,
                    "verify_nbf": False,
                },
            )
            issued, expires, not_before = (
                claims["iat"],
                claims["exp"],
                claims.get("nbf", claims["iat"]),
            )
            if any(
                isinstance(v, bool) or not isinstance(v, int) for v in [issued, expires, not_before]
            ):
                raise ValueError("invalid lifetime")
            now = self._clock()
            if (
                not issued <= now + 30
                or not not_before <= now + 30
                or expires <= now
                or not 0 < expires - issued <= 3600
            ):
                raise ValueError("invalid lifetime")
            roles = claims.get(f"urn:zitadel:iam:org:project:{self._config.audience}:roles", {})
            grants = roles.get("roamie.manager", {}) if isinstance(roles, dict) else {}
            if (
                claims["sub"] != self._subject
                or not isinstance(grants, dict)
                or self._organization not in grants
            ):
                raise ValueError("wrong workload grant")
            for name, expected in [
                ("x-jwt-claim-sub", self._subject),
                ("x-jwt-claim-tenant-id", "roamie"),
                ("x-jwt-claim-scope", "roamie:travel:read"),
            ]:
                forwarded = request.header_values(name)
                if forwarded and forwarded != (expected,):
                    raise ValueError("conflicting forwarded identity")
            return CallContext(
                identity=AuthenticatedIdentity(
                    tenant="roamie",
                    subject=self._subject,
                    issuer=self._config.issuer,
                    scopes=("roamie:travel:read",),
                ),
                request_id=request_id,
                run_id=request_id,
                deadline=time.monotonic() + self._config.request_timeout_seconds,
                cancellation=cancellation,
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            raise HTTPRequestAuthenticationError(request_id=request_id) from None
