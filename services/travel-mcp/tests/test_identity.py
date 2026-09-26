import json
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from tesserix_mcp_runtime.adapters.gateway_identity import GatewayIdentityConfig
from tesserix_mcp_runtime.adapters.streamable_http import (
    HTTPRequestAuthenticationError,
    HTTPRequestMetadata,
)

from roamie_travel_mcp.identity import ZitadelContext

PROJECT = "387190457387450503"
ORG = "386377229942128837"
ROLE = f"urn:zitadel:iam:org:project:{PROJECT}:roles"


class Cancellation:
    cancelled = False

    async def wait(self):
        pass


@pytest.fixture
def configured():
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    key = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(private.public_key()))
    key.update(kid="known", alg="RS256", use="sig")

    class Keys:
        async def fetch(self):
            return {"keys": [key]}

    config = GatewayIdentityConfig(
        issuer="https://auth.tesserix.app",
        audience=PROJECT,
        jwks_url="https://auth.tesserix.app/oauth/v2/keys",
        jwks_allowed_hosts=("auth.tesserix.app",),
        trusted_proxy_cidrs=("10.0.0.0/8",),
    )
    return private, ZitadelContext(
        config, manager_subject="manager-subject", organization=ORG, fetcher=Keys()
    )


def metadata(private, changes=None, peer="10.1.2.3", extra=()):
    now = int(time.time())
    claims = {
        "iss": "https://auth.tesserix.app",
        "aud": [PROJECT, "other-audience"],
        "sub": "manager-subject",
        "iat": now,
        "exp": now + 3600,
        ROLE: {"roamie.manager": {ORG: "tesserix.app"}},
    }
    claims.update(changes or {})
    token = jwt.encode(claims, private, algorithm="RS256", headers={"kid": "known"})
    return HTTPRequestMetadata(
        method="POST",
        path="/mcp",
        peer_host=peer,
        headers=(("Authorization", "Bearer " + token), *extra),
    )


async def test_zitadel_role_maps_to_one_tenant_and_scope_after_verification(configured):
    private, verifier = configured
    context = await verifier.create(metadata(private), cancellation=Cancellation())
    assert context.subject == "manager-subject"
    assert context.tenant == "roamie"
    assert context.scopes == ("roamie:travel:read",)


@pytest.mark.parametrize(
    "changes",
    [
        {"sub": "other-agent"},
        {"aud": ["other-project"]},
        {ROLE: {"agentgateway.mcp": {ORG: "tesserix.app"}}},
        {"exp": 1},
        {"iss": "https://other.example"},
        {ROLE: {"roamie.manager": {"other-org": "other.example"}}},
    ],
)
async def test_other_identity_audience_org_or_role_is_denied(configured, changes):
    private, verifier = configured
    with pytest.raises(HTTPRequestAuthenticationError):
        await verifier.create(metadata(private, changes), cancellation=Cancellation())


async def test_untrusted_peer_and_spoofed_headers_are_denied(configured):
    private, verifier = configured
    for request in [
        metadata(private, peer="192.0.2.1"),
        metadata(private, extra=(("x-jwt-claim-sub", "victim"),)),
    ]:
        with pytest.raises(HTTPRequestAuthenticationError):
            await verifier.create(request, cancellation=Cancellation())
