# Dedicated Roamie PostgreSQL runtime

Roamie owns a two-instance CNPG cluster in its existing namespace. This change
connects the deployed API and installs the previously designed group/itinerary/
expense schema; it does not expose unauthenticated persistence endpoints.
Existing mobile trip storage remains local until the authenticated group API
and mobile synchronization work are released.

Initial capacity assumption: 20 database requests/second, records below 256 KiB,
80:20 reads:writes, under 10 GiB in year one; revisit at 70% disk use or sustained
pool saturation. These are sizing assumptions, not measured traffic. Two API
replicas use at most 20 connections of the database's 100; rollout surge and the
migration job retain ample headroom. Desired database-dependent API SLO is 99.9%
and p99 below 300 ms, to be measured once persistence endpoints are released.

The API uses `roamie_app`; only the bounded pre-rollout migration job uses the
non-superuser database owner. Credentials come from separate ExternalSecrets.
Connections verify the CNPG CA and service hostname using TLS verify-full.
Runtime DML cannot alter schemas, migration history or existing audit records.
No database credentials or user data are returned by readiness checks.

Pool acquisition is bounded to three seconds and statements to ten seconds.
Readiness fails on database loss; liveness does not depend on PostgreSQL.
Migrations are embedded, serialized by sqlx's migration lock, and transactional.
They have explicit lock/statement timeouts. Applying them twice is harmless.

Migrations are forward-only and additive. Application rollback retains the
schema and volumes; there is no destructive down migration. Use a separately
approved restore for recovery, never delete the CNPG cluster as rollback.
The two synchronous instances tolerate a primary failure but loss of the only
standby can block acknowledged writes; three replicas would improve that tradeoff
at additional cost. Storage reserves 30 GiB total plus seven-day GCS backups;
compute shares the existing GKE nodes. Restore RTO/RPO remain unverified until a
restore drill. Native TLS plus namespace NetworkPolicies bound database access;
no public persistence API is introduced by this rollout.

Validation: real PostgreSQL owner/runtime-role tests, migration replay,
balanced/unbalanced transactions, and HTTP readiness/liveness on pool loss.
