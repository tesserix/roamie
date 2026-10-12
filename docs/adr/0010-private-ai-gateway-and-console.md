# Private AI gateway and console attribution

Roamie generation and TypeSafe judgments go through a dedicated native
AgentGateway data plane, `roamie-ai`, using the same platform runtime and usage
pipeline as Kora. Release builds require its exact private service origin and
cannot fall back to direct Vertex. Local debug builds may retain Vertex for
translation UI work; debug bypass cannot supply a verified gateway identity.

Traffic forecasts remain unmeasured. The existing planning assumption is 20 API
requests/second; at 10% model traffic that is 2 model requests/second. Two gateway
replicas each admit 120 requests/minute with a burst of 20, leaving aggregate
4 requests/second admission. This is an aggregate limit, not a per-user quota.
Gateway requests buffer at most 12 MiB, compatible with an 8 MiB decoded photo
and base64 overhead. Generation has a 45-second budget; JEV has 1.5 seconds and
one attempt. OCR's default overall budget is 40 seconds, leaving the combined
pipeline inside the 90-second photo API and 95-second mobile budgets.
The 99.9% API SLO is a target; it has not been measured. Two gateway replicas
reserve 512 MiB total memory; incremental cloud cost has not been measured.

The valuable assets are customer tokens, document content and provider keys.
Authenticated users, another workload or a compromised dependency could attempt
to steal them. The API verifies issuer, audience, allowed mobile client, expiry,
organization and verified email before creating request-scoped gateway context.
Tokio task-local context carries only the verified token and operation name;
concurrent requests cannot inherit another account's identity. Missing context
fails closed, and client attribution headers are never trusted. The gateway
independently verifies the Zitadel JWT and admits only Roamie's API workload over
Istio. It captures the verified subject into metadata before removing customer
authorization and attribution headers on external provider requests. Vertex uses
the gateway's Workload Identity; TypeSafe uses the gateway-only OpenBao reader.

Generation uses the existing OpenAI-compatible gateway contract. Text, inline
image and audio data and JSON schemas are converted centrally; model responses
are capped at 2 MiB. OCR text is redacted before JEV and extraction. JEV retains
its pinned model, strict Choice validation and 64 KB response cap. Gateway
configuration/identity errors are startup failures; upstream failures produce
friendly errors without a direct-provider retry. Provider failure does not affect
offline SOS and communication cards.

Registry owns the nine new backend, route and policy resources. The owning Helm
chart creates runtime, secrets and mesh admission, and can render the native
resources only for export/rollback. A new workload-identity member binds
`agentgateway-system/roamie-ai` to the existing gateway GSA. The production Argo
Application is a manual-sync candidate; nothing has been applied live. Roll out
the gateway and credential reader before importing routes and changing the API
image. Keep the previous application digest and Registry desired-state revision
for rollback. Disabling an additive seed is not a rollback of imported resources.
No new product database, queue, billing service or migration is introduced.

The gateway exports every request's product `roamie`, service `roamie-api`,
verified user subject, operation, model, token counts, outcome and latency to
`ai-usage-ingest`. JEV adds its resolved model and measured input/output tokens.
The existing durable pipeline and transactional replay deduplication feed the
console's platform AI usage page. Prices remain dated estimates, with TypeSafe
input-only prices explicitly partial. No document text, answers, credential or
photo enters telemetry. Roamie is added to the console estate and display names.
This is AI usage integration; a full Roamie admin rail, user-name lookup and
product metrics endpoint remain separate, unimplemented contracts.

A standalone-console overlay was rejected: it would create a second owner and
split production accounting from Registry-owned routes. Reusing Kora's Firebase
route or a manager's OAuth identity was rejected because it would cross product
and workload authorization boundaries.

Validation includes a signed-customer API → OCR → gateway/JEV → gateway/generation
receipt regression, account-concurrency isolation, installed-CRD server dry-run,
Helm and Terraform checks, a real AgentGateway v1.4.1 synthetic credential/header/
JWT/export probe and a real-Postgres console ledger replay test. These establish
contract behavior, not production mesh admission, provider accuracy or live
console freshness. Production authenticated tests and language/document
calibration remain release gates.
