# Hardened Expedia recommendations MCP

A Roamie-owned implementation of the four recommendation tools in
[Expedia's official server](https://github.com/ExpediaGroup/expedia-travel-recommendations-mcp),
reviewed at upstream commit `64cdfb15525bb2e4146ddf1be708693f91c110a2`.
This is a derivative integration candidate, not a deployment or Expedia partner
approval. The upstream licence is retained in `LICENSE`. No upstream FastMCP
implementation or unsafe request client is run in this package.

Tools: `get_hotel_recommendations`, `get_flight_recommendations`,
`get_activity_recommendations`, and `get_car_recommendations`. Input names follow
the source signatures, with bounded strict validation. Result contracts have
changed: `status` is `ok` or `unavailable`; `data_json` carries validated provider
JSON when successful. Decimal numbers are encoded as exact strings. This opaque
provider evidence is not a quote guarantee and must be normalized/revalidated
before price display or a booking flow. Consumers need a new schema pin.

## Security boundary

Provider and gateway credentials, traveller queries and responses are sensitive
assets. Threats include leaked log/error contents, untrusted direct callers,
forged forwarding headers, redirected credential requests, oversized responses,
and retry/concurrency amplification. The four tools only read public travel
recommendations; no booking, payment, account, or private traveller-record tool
exists.

- The house runtime applies schema, execution and HTTP limits.
- `/mcp` requires one constant-time-checked, server-specific `X-MCP-Key` and an
  explicitly trusted socket-peer CIDR. Keys must be 32–256 visible ASCII
  characters. Wildcard CIDRs are rejected. HTTP host/origin checks are enabled.
- A valid service credential grants only tenant `roamie` and
  `travel:recommendations:read`. No forwarded identity/tenant/scope header is
  trusted. This is service authorization for public recommendations, not
  end-user JWT verification. Any private or user-specific capability requires
  verified caller context and object-level authorization before addition.
- Gateway JWT authorization and workload/waypoint Ambient mTLS policies must
  restrict the route to approved Roamie callers before deployment. A pod CIDR
  is not a substitute for a workload identity policy. Do not expose this directly
  through public Ingress or NodePort.
- Upstream host and four GET paths are fixed. One `X-API-KEY` authentication
  scheme is used; Basic Auth fallback, redirects, implicit proxy credentials and
  retries are disabled. Header/secret material is never logged. HTTP library
  logging is suppressed because URLs contain traveller queries.
- Requests have connect/read/pool limits and an 8-second overall cancellation
  deadline. The runtime caps concurrency at 16 (8 per tool), with one attempt,
  an 8 KiB input budget and a 10-second call budget.
- Decompressed upstream JSON is capped at 64 KiB, 16 nested levels and 500 items
  per collection. Duplicate properties, nonfinite numbers, malformed/non-JSON
  responses and redacted secret-bearing responses fail closed.
- Failure responses carry no provider error body, URL, key or exception detail.
  When disabled or missing credentials, no upstream request is made. Enabling
  without a credential fails startup. Configuration failures print only a fixed
  diagnostic, not a Pydantic settings/environment dump.

## Runtime settings

| Variable | Purpose |
| --- | --- |
| `EXPEDIA_API_KEY` | Provider credential from OpenBao. Never a build arg or Git value. |
| `EXPEDIA_MCP_GATEWAY_KEY` | Dedicated server credential, distinct from the provider key. |
| `EXPEDIA_MCP_ENABLED` | Defaults to `false`; set `true` only after approved access/probes. |
| `EXPEDIA_MCP_HOST` / `EXPEDIA_MCP_PORT` | Defaults to loopback / 8080. GKE must explicitly configure the pod listener. |
| `EXPEDIA_MCP_GATEWAY_CIDRS` | Comma-separated trusted socket networks; defaults to loopback only. |
| `EXPEDIA_MCP_ALLOWED_HOSTS` | Explicit service host allowlist; defaults to localhost/loopback. |
| `EXPEDIA_MCP_ALLOWED_ORIGINS` | Explicit origins; defaults to `http://localhost`. |

Run `python -m expedia_recommendations_mcp.main` after configuring the service
credential securely. Native Streamable HTTP is `/mcp`; `/livez` and `/readyz`
are runtime lifecycle probes, not proof of provider inventory access. A disabled
provider can be healthy while returning `unavailable`.

The native protocol is `2026-07-28`. Use a compatible MCP client; it negotiates
initialization and sends the required `MCP-Method` header and protocol/capability
`params._meta` envelope for subsequent requests. Do not hand-copy an older
provider's HTTP request shape.

## Delivery and verification

The image uses digest-pinned builder/runtime images and a locked dependency
graph; its default user is `10001:10001`. Run it with read-only root filesystem,
dropped capabilities, no privilege escalation and bounded CPU/memory. Credential
material must be injected only at runtime. No image is pushed or chart enabled
by this package. Generate the schema catalog with `scripts/export_catalog.py`; it has no remote
endpoint and gateway export remains disabled. Native Registry publication awaits
a verified deployment endpoint. The manifest compiler requires HTTPS remotes;
the intended pod HTTP endpoint is protected by Ambient mTLS, so it is not declared
as a working HTTPS service.

```sh
uv sync --frozen
uv run pytest
uv run ruff check .
uv run ruff format --check .
uv run mypy --strict src/
uv run python scripts/export_catalog.py
uv build
```

The security regression first reproduced the upstream API-key log leak using a
dummy key. Tests cover safe logging, authentication/redirect/timeout failures,
secret-bearing/oversized/deep/duplicate JSON, exact decimals, disabled providers,
input bounds, cross-tenant denial and native HTTP initialization/discovery.
Dependency auditing covers packages on public advisory catalogs; local Tesserix
artifacts are not on PyPI and are reported as unauditable by that tool. Their
release hashes are locked, but hashes do not substitute for source review.

Real provider authentication, endpoint entitlements, a successful live Expedia
query, GKE workload identity admission, consumer normalization/schema pins and
production rollout are still gates. In particular, the upstream source is the
basis for `X-API-KEY` and `apim.expedia.com/recommendations/*`; no live key was used
to prove that those endpoints are available to this account.

## Capacity and operations

Use the reviewed travel hosting assumptions: peak 2 calls/s,
read-only traffic, 2x annual growth, no persisted provider inventory at 12/36
months, target p99 below 5 seconds with an 8-second provider deadline, and a
99.9% internal availability target limited by the external provider. An 8-second
peak occupancy needs 16 in-flight calls. The concurrency ceiling bounds that
occupancy; provider quotas may require a lower gateway rate.

No database, queue or write compensation is introduced. Upstream outages return
`unavailable`; duplicate reads do not purchase anything. Metrics/logging of
provider latency and failure category still need deployment wiring; the runtime
telemetry sink here does not emit request payloads. Operating cost is the
connector allocation, provider calls and egress; partner rates are unknown.

The simplest alternative, running the official image unchanged, was rejected
because its client leaks headers and has unbounded requests. The isolated
derivative keeps those fixes independent of unrelated travel connectors.
Promotion must be through the owning GitOps repo with an immutable image,
internal Registry record, reviewed role plan and passing gateway canaries.
Rollback requires specific approval and changes only this connector's release
pin/route access, with the previous image and Registry revision retained.
