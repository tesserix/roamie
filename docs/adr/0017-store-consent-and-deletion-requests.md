# 0017 — AI consent and in-app deletion requests

Status: local implementation; production rollout and verification required.

Apple requires explicit permission before personal data is shared with third-party
AI and an in-app way to initiate account deletion. Manual fulfilment is permitted.
On 21 October 2026 the product owner assigned sales@tesserix.app to fulfil requests
and confirm completion within 30 days, including associated Roamie personal data.

Use the existing authenticated API and Postgres. Planning envelope (assumptions,
not measured demand): fewer than 1 deletion request/second at peak, no request
payload, under 1 KB per row, at most 10,000 requests/year (~10 MB/year before
indexes), mostly reads by support. Target acknowledgement p99 < 1 second and the
API's existing availability; a transaction durably accepts before responding.
No new service or queue is needed. A unique verified subject makes retries
idempotent and preserves the original deadline. Clients cannot select a subject,
change status, or mark requests completed. Failure to persist returns an error.

The asset is the customer's account and personal data. An unauthenticated caller
or another customer must not initiate or inspect deletion for somebody else.
The JWT verification boundary supplies subject, issuer and verified contact email.
The endpoint exposes only the current customer's request, uses no-store, and
never claims deletion has completed when it has only recorded a request.

Support checks the durable pending-request queue every working day and coordinates
deletion across Roamie storage, identity grants and processors. Completion requires
evidence and email confirmation. See the fulfilment runbook. Do not delete shared
Tesserix identities or other travellers' data. Statutory retention and backup
expiry must be explained individually; a request is not proof of a successful purge.

AI consent is versioned and scoped to the signed-in account on this installation.
Native disclosure requires Allow and continue before AI requests. Refusal is
remembered; settings allows review or withdrawal. Account/session changes, storage
errors and cancellation fail closed. Non-AI local tools and emergency help remain
available. Consent does not grant permission to publish or share with other users.

The additive migration can be reverted locally by removing the new table and
SQLx version only in an isolated scratch database. In production keep accepted
requests durable when rolling back code; do not drop the queue or its records.
Deploy backend/schema before a mobile build using the new endpoint.

Saved translations now use atomic contribution records scoped to the verified
customer. New text without ownership is dropped; legacy unlinked rows are not
served. OCR reserves an ownership/idempotency record before calling a provider,
uses a per-account photo key, then records upload/job identifiers. A provider
failure leaves a recoverable reservation; storage failure stops the upload.
Production OCR requires ownership storage. No image or document contents enter
these ownership tables. Manual fulfilment uses these exact resource identifiers.
The additive ownership migration does not delete the existing corpus.

Read-only production discovery on 21 October found 131 unlinked phrasebook rows,
five account records, six applied migrations, two ready API replicas and two CNPG
instances with seven-day backup retention configured. No customer rows were read
or deleted. Cut over all API replicas before counting and removing the legacy
unlinked corpus, with specific approval and a protected recovery capture. Do not
submit the current build as if these changes already run in production.
