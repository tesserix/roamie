# Personal trip manager identity

Customer authentication remains owned by the existing Roamie/Zitadel boundary.
`PUT /v1/trips/{trip}/profile` saves the authenticated customer's preferences;
`GET` returns the saved profile and server-generated revision. The PUT body is
`{"expected_revision": null, "preferences": {"allergies": ["peanuts"]}}` for
creation, and must carry the current revision for updates. Concurrent or stale
writes return 409. Identity/revision fields are not accepted as preferences.
Profiles are personal to `(authenticated subject, trip ID)`; a local trip ID does
not grant access to another customer's profile or any shared group resources.

`POST /v1/trip-manager` accepts the saved trip ID and revision in `profile`.
The API loads preferences from Postgres, replaces all client preference fields,
signs the authenticated snapshot, and validates the returned manager ID and
revision. The manager calls `/internal/v1/travel/profile/verify` before evidence
fetch and during review; that endpoint requires the manager workload key and
compares the full profile against storage. The API rereads the revision before
responding. Changed, missing or unavailable profiles fail closed.

The API and manager require the same `TRIP_MANAGER_IDENTITY_KEY` /
`ROAMIE_MANAGER_IDENTITY_KEY`. This derives an opaque, stable manager ID from
`["roamie", authenticated subject, trip ID]`. Cross-language golden vectors
include a non-ASCII trip ID. Never put the key or customer preferences in logs.

The product MCP accepts only the declared manager machine subject, carrying the
`roamie.manager` role from organization `386377229942128837` in the AgentGateway
project `387190457387450503`. Generic gateway tokens and spoofed forwarded claims
are rejected. Its configuration adds `ROAMIE_MCP_MANAGER_SUBJECT` and
`ROAMIE_MCP_ORGANIZATION`. Existing upstream service-key verification remains.

## Migration and rollout

`202609260002_personal_trip_profiles.sql` adds a bounded personal-profile table,
an audit trigger, and least-privilege runtime grants. It changes no existing
rows. Local isolated Postgres integration tests cover customer isolation, stale
writes, audits and existing runtime-role separation. The migration is additive;
application rollback retains the table and customer data. Dropping it after use
would destroy saved preferences and is not an automatic rollback operation.

Production migration and rollout require explicit approval under the working
agreements. The AI chart remains disabled until registry routes and the complete
identity path have been validated. Clients must save/load a profile before
requesting advice; the unreleased mobile integration needs that API wiring.
