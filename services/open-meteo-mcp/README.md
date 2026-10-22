# Roamie Open-Meteo weather MCP

A product-owned, read-only adapter to the official [Open-Meteo Forecast API](https://open-meteo.com/en/docs). This is our MCP implementation; an Open-Meteo-operated MCP was not verified. One native `2026-07-28` Streamable HTTP tool, `get_weather_forecast`, returns up to 16 daily forecasts for one coordinate. Celsius, precipitation probability, UV and WMO codes retain provider dates and units. Measurements are exact decimal strings; retain the attribution and source URL when displaying data. Forecasts are model estimates and do not establish emergency warnings or long-range conditions.

## Access and security

[Pricing](https://open-meteo.com/en/pricing) and [terms](https://open-meteo.com/en/terms) checked on 2026-10-12: the free API supports evaluation/prototyping and non-commercial usage. Commercial Roamie activation requires a subscription and issued key for `customer-api.open-meteo.com`. No subscription was purchased. The free endpoint has minute/hour/day/month limits and no uptime guarantee; the runtime's concurrency limit is not a daily quota mechanism. A central provider budget and contracted monthly volume must be set before activation.

Coordinates, gateway credentials and paid provider keys are sensitive assets. Untrusted callers, other tenants and compromised upstream responses cross the gateway/service/provider boundaries. `/mcp` accepts one constant-time-verified dedicated service key and a configured socket-peer CIDR; forwarded tenant/identity/scope headers cannot grant authority. Only Roamie's `weather:forecast:read` service scope is granted. This connector exposes public forecasts, not private traveller records. End-user JWT authorization and Ambient workload/waypoint policies must be enforced at the gateway before deployment.

The upstream host is fixed by operator mode, never user input. Only `/v1/forecast` GET is used. Redirects and retries are disabled. The runtime disables environment proxies, caps concurrency at 16, inputs at 8 KiB and calls at 10 seconds. The provider gets one 8-second overall attempt, with connect/read/pool limits, and a 64 KiB decompressed JSON ceiling. Duplicate/nonfinite/deep/oversized JSON, invalid units/dates, reflected keys and inconsistent temperatures fail unavailable. HTTP-library URL logs are suppressed: the paid API requires `apikey` in its query string. Provider URLs, payloads and errors must not be captured by gateway/egress access logs either. Runtime telemetry here emits no payloads; deployment must wire safe latency/error metrics.

## Configuration

| Setting | Purpose |
| --- | --- |
| `OPEN_METEO_MCP_GATEWAY_KEY` | Dedicated 32–256 visible ASCII service key, distinct from provider key |
| `OPEN_METEO_API_KEY` | Issued paid provider key, injected at runtime from OpenBao |
| `OPEN_METEO_MCP_ENABLED` | Defaults `false` |
| `OPEN_METEO_MCP_MODE` | Defaults `commercial`; explicit `evaluation` uses the free endpoint and rejects a paid key |
| `OPEN_METEO_MCP_HOST` / `OPEN_METEO_MCP_PORT` | Defaults loopback / 8080; configure pod listener explicitly |
| `OPEN_METEO_MCP_GATEWAY_CIDRS` | Trusted socket networks; defaults loopback, no wildcard networks |
| `OPEN_METEO_MCP_ALLOWED_HOSTS` / `OPEN_METEO_MCP_ALLOWED_ORIGINS` | Explicit service authorities/origins |

Enabled commercial mode without a provider key fails startup. A disabled pod may pass `/livez` and `/readyz` while tools return `unavailable`; readiness does not prove provider access. Secrets belong in Roamie-prefixed OpenBao paths, with separate development/production readers. Never bake them into images or commit them.

## Verification

```sh
uv sync --frozen
uv run ruff format --check .
uv run ruff check .
uv run mypy --strict src/ scripts/
uv run pytest --cov=open_meteo_mcp --cov-fail-under=85
uv run python scripts/export_catalog.py
uv build
```

The deterministic catalog has `gatewayExport:false` and no fabricated endpoint. Container QA uses UID 10001, read-only root, no networking, dropped capabilities, no privilege escalation and a dummy service key. `scripts/smoke_container.py` is a client executed inside a running disabled container. Native initialization/discovery, unauthenticated rejection, disabled calls and a positive attributed in-process tool call are tested. One anonymous live evaluation call returned two Melbourne days. Paid-account credentials and production gateway access remain unverified.

## Hosting and Roamie connection gates

Source, contracts, image and CI belong to Roamie; desired Kubernetes state belongs to `tesserix-k8s`. Give this connector an independent image/release pin, ServiceAccount and two replicas once user-critical, with resource requests, memory limit, lifecycle probes, PDB/topology spread, read-only filesystem, STRICT Ambient mTLS, workload and waypoint admission restricted to AgentGateway, and bounded fixed-host egress. Do not expose a public Ingress/NodePort. A verified native endpoint and reviewed schema pin must precede Registry export; do not claim an HTTP pod endpoint is HTTPS. Gateway native-runtime compatibility still needs a canary.

Planned path: `/mcp/roamie/roamie-open-meteo-mcp`, not active. `X-MCP-Key` must be brokered by AgentGateway; caller-supplied keys/cookies/provider headers are stripped. Admit only the approved Roamie manager subject/role, allowlist `get_weather_forecast`, and inject the server key independently from the upstream key. Rate/budget controls must honor the selected account. Native MCP clients must initialize and send negotiated `MCP-Method` plus protocol/capability metadata.

Roamie's current weather source remains Google Weather. The manager's single `travel_search` contract cannot be pointed at this raw tool. Before switching or composing sources, add a schema-pinned gateway client that maps these daily observations into the weather evidence contract, preserves attribution/observation time/local dates, declares missing coverage, and never manufactures forecasts beyond the horizon. Do not add silent cross-provider retries. The mobile app continues using Roamie's authenticated API.

Planning assumptions: 2 peak reads/s, 100:0 read/write, no retained inventory at 12/36 months, 2x annual growth, target p99 under 5 seconds and 99.9% internal availability bounded by the provider. Eight-second occupancy requires at most 16 slots at that peak; provider quotas may require less. No database or queue is needed. Upstream outage returns `unavailable`; duplicate reads cannot book/pay. Costs are replicated compute, egress and subscription/volume; no contracted account price is known. The existing direct Google source is the simplest alternative but does not provide the separately requested MCP boundary. Production rollout and rollback require named approval through GitOps; retain the previous image/catalog revision and revoke gateway admission for an approved access rollback.
