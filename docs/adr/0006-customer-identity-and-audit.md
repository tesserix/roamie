# Customer identity, reference data and transactional audit

Roamie's internet-facing utility API must verify the customer before accessing
Vertex, Places or private account data. Assets include verified email addresses,
trip records and audit history. Unauthenticated callers and customers attempting
to read another customer's records cross the API trust boundary; the API's
restricted database role is a separate boundary from the migration owner.

Use the existing Zitadel project under TESSERIX with separate native iOS and
Android clients. Accept only RS256 access tokens for the configured issuer,
project audience and client IDs. Validate expiry and not-before, then check
UserInfo for a matching subject, organization and verified email. UserInfo
failure denies access; an identity-provider outage returns 503. JWT and response
sizes, HTTP timeouts and JWKS cache refreshes are bounded. An application outage
does not erase persisted accounts. Anonymous health, readiness and public social
configuration are the only public routes. No username/password flow is added.

`GET /v1/auth/me` synchronizes the verified account in a transaction with its
audit event. Repeated identical requests do not update or add audit rows.
Case-insensitive email uniqueness prevents separate subjects from claiming one
email; a conflict returns 409 and never merges accounts. Changed profile fields
are written atomically. A crash before commit rolls both account and audit back.
`GET /v1/auth/audit?after=<id>` scopes its query to the verified subject and
returns at most 20 events plus a next cursor. Both responses use `no-store`.
`GET /v1/reference/trip-styles` also requires a verified customer.

Database triggers capture changes to accounts, groups, membership, invitations,
itineraries, expense rows/splits and travel styles. Events include the actor,
database login, operation, entity, group, timestamp and changed column names.
They deliberately omit field values, emails, tokens and request bodies. The
runtime cannot write or modify this audit table; ordinary owner DML cannot
update, delete or truncate audit records either. Owners/superusers can still
alter the schema: this is append-only application audit, not tamper-proof storage.
The runtime actor setting is trusted application context, not a database proof
of identity. Audit records survive deletion of their original entities.

Migration `202609260001` is additive and forward-only. Apply with the owner
before rolling out the API; retain the schema during application rollback.
Never roll back to an unauthenticated public image as a routine recovery action.
The migration seeds only eight non-personal travel-style reference rows.
`services/api/seeds/development.sql` is a separate, repeatable synthetic fixture
that refuses databases whose names do not match `^roamie_.*test$`. It is never
included in automatic production migration execution.

For local development, `AUTH_ENABLED=false` requires a debug build, loopback
binding and a local database. Release binaries reject the bypass and require
database configuration. Mobile development without login must use that local
API; production calls require a real customer access token.

Capacity assumptions remain 20 requests/second and 80:20 reads:writes from
ADR-0005, with payloads below 32 KiB for identity and audit responses. Assuming
one million audited mutations/year at roughly 1 KiB including indexes, budget
approximately 1 GiB/year, 3 GiB over three years, and measure actual growth.
Target 99.9% availability and p99 under 1 second for identity-backed requests;
these are targets, not measured guarantees. UserInfo adds one IdP call per
request so token revocation is checked without a session cache. Existing CNPG
capacity is reused without another service or datastore. Per-customer abuse
controls remain tracked in #45; retention policy in #8; recovery drill in #85.

Required configuration: `ZITADEL_ISSUER`, `ZITADEL_ORG_ID`,
`ZITADEL_PROJECT_ID`, `ZITADEL_IOS_CLIENT_ID`, `ZITADEL_ANDROID_CLIENT_ID`,
and at least one of `ZITADEL_GOOGLE_IDP_ID`, `ZITADEL_APPLE_IDP_ID`,
`ZITADEL_FACEBOOK_IDP_ID`. Unconfigured social providers are omitted from public
configuration. These IDs are public; credentials remain in the secret store.

Validation uses real PostgreSQL with distinct owner/runtime roles, signed JWTs
against a mock external IdP, cross-customer audit isolation, email conflicts,
migration replay and audit immutability. Actual social-provider sign-in still
requires a device session and cannot be inferred from these tests.
