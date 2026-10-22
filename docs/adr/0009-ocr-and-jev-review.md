# OCR evidence and TypeSafe JEV review

Roamie reuses Document Intelligence for extraction and TypeSafe's JEV 1.13.0
Choice contract, already validated by Kora. Authentication, money conversion,
source status and user confirmation remain application rules. JEV judges bounded
text evidence; it does not read image/audio bytes or establish numerical truth.

Use the existing API and OCR services without a new database, queue or service.
Existing planning assumes 20 API requests/second; actual photo traffic and vendor
cost have not been measured. Uploads remain at most 8 MiB decoded. Each JEV call
has a 1.5-second deadline, one attempt, a 16,000-byte request limit and a
64,000-byte response limit. OCR and AI route deadlines bound the entire operation.
The 99.9% API availability goal remains a target, not a measured guarantee.

The API sends the typed Choice contract to its private gateway's `/v1/decisions`.
The gateway alone calls TypeSafe `/v1/systemone`, pins the provider model and
injects the OpenBao credential. The API holds no TypeSafe key. This replaces the
initial direct-provider implementation after the gateway requirement was clarified;
see [ADR 0010](0010-private-ai-gateway-and-console.md). Roamie delegates its
verified Zitadel customer access token and uses its own Kubernetes service account,
with strict mobile-client audience validation and workload admission at the gateway.
No Firebase credential or Kora service identity is reused.

Reject redirects, malformed probabilities, unknown choices, missing usage,
different resolved models and oversized responses. No prompt, source text, key
or provider body enters logs. A configured judge failure stops downstream AI;
no decision or confidence overrides deterministic checks.

Keep OCR job identity and partial/review-required status in the result. A retake
decision stops extraction; a review decision remains visible to the traveller.
Receipts and statements use OCR text when OCR is configured, with explicit user
review before saving. Existing vision extraction remains the development fallback
when OCR is absent; production must configure OCR and JEV together. Missing or
invalid OCR configuration must not silently enable that fallback in production.

Provider privacy/retention admission and language/quality calibration are release
gates before real documents are sent. Synthetic contract tests prove integration
and failure behavior, not accuracy. Metering and per-user abuse controls remain
release gaps; no cost-savings claim is made.

Copy an explicitly pinned Kora key version to
`roamie/app/roamie-typesafe-api-key` with create-only semantics and verify equality
without printing either value. Development uses
`roamie-development/app/roamie-typesafe-api-key`. Rotation must update both
product copies until separate vendor keys are issued. Do not delete the source.
Deploy the OpenBao gateway reader and API environment through the owning GitOps repository
only after review. Rollback uses the previous application image, retaining source
documents and secrets; no migration or destructive live operation is involved.
