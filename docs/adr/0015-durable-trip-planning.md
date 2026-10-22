# Durable trip-planning comparisons

## Context and measured failure

On 13 October 2026, production Android and iOS comparisons succeeded after the
planning optimisations, but a repeat iOS comparison returned 503 in 51.5 seconds.
The gateway recorded a planner request cancelled at 49.966 seconds without a
response. Other generation calls took 22–26 seconds and one short review took
42.795 seconds. These samples establish intermittent provider latency, not a p99.
A bounded duplicate-call experiment also exceeded the deadline during deliberate
stall injection and was not released.

The mobile flow currently waits for the complete comparison in one HTTP request.
The selected itinerary is safe, but unfinished work and its progress cannot be
resumed after timeout or navigation. Increasing that single request timeout does
not provide restart recovery.

## Decision

Add a durable, user-scoped planning job to the existing Roamie API and Postgres.
Keep the existing synchronous endpoint for older clients and other specialists.
New mobile clients use POST/GET/DELETE `/v1/trips/{trip}/planning`.

POST validates the authenticated owner and authoritative profile revision, stores
the canonical profile/request, and returns 202. A unique constraint on owner,
trip, profile revision and request hash makes repeated submission idempotent.
A user has at most two active jobs across trips and one per trip. Starting a new
comparison cancels the previous active job for that trip.

Two worker loops per API replica claim jobs with `FOR UPDATE SKIP LOCKED` and a
120-second lease. The manager RPC retains its existing 85-second bound and its
mandatory typed validation, request review and independent response review.
Only transient failures retry: at most three attempts, with five seconds between
attempts. Rejected reviews and invalid requests stop; changed profiles stop.
The manager classification prerequisite is ai-agents PR #94.

A completion writes only when the lease token and running status still match.
Cancellation and restart recovery therefore fence stale workers. The worker checks
the authoritative profile before and after the RPC; reads also join its current
revision. Results never apply themselves to the itinerary: the user still chooses.

Jobs expire after ten minutes, including when workers are unavailable. Job inputs
and results are removed after 24 hours in bounded batches. They contain user trip
preferences but no credentials or gateway tokens. Account/profile deletion cascades
to jobs. Every endpoint scopes both reads and writes to the authenticated subject;
a guessed job ID cannot read or cancel another user's work.

Mobile polling uses short HTTP requests and resumes the same server job when the
trip manager is reopened. Leaving the screen stops polling without cancelling the
job. Explicit cancellation supplies the precise job ID; a stale screen cannot
cancel a newer comparison. Temporary network/gateway errors retain the saved job.
Existing review, budget, date and source validation is applied before displaying
any recovered result.

## Capacity, cost and observability

With the current two API replicas there are at most four active background manager
calls, within each replica's existing eight-request manager semaphore. At 40–80
seconds per attempt, this is approximately 3–6 attempts/minute before retries.
Peak arrival rate and growth are not established; this change makes no throughput
SLO claim. Queued work expires rather than creating unbounded model concurrency.
Each job is capped at 32 KiB input and 128 KiB result; the 24-hour retention bounds
history. No new service, database, replicas, credentials or infrastructure is added.
Retries can incur up to three whole-comparison costs; they are sequential and
bounded. Job/attempt/terminal outcome logs contain identifiers only, never prompts
or provider responses. Failure rate and queued age should be observed after release.
A correlated provider outage can still end in an explicit failed job.

This is a durable single remote read followed by a result write, without business
side effects or compensations. Reusing the existing database and API workers is
smaller than introducing a Temporal namespace, access rules and another worker
lifecycle for this operation. A multi-step booking/payment saga would use Temporal.

## Migration and release

1. Merge/release ai-agents #94 so terminal reviews cannot be retried as outages.
2. Obtain explicit approval for production migration
   `202610130001_trip_planning_jobs.sql`. It adds one table and indexes and grants
   the existing runtime role DML on that table. It does not alter existing tables.
3. Apply the migration with the existing migration role through GitOps; deploy the
   matching API image. The API runtime role cannot apply schema changes.
4. Release updated Android/iOS clients after the job endpoints are healthy.
5. Verify repeated real comparisons, cancellation, reopening and choosing a plan
   on both emulators before declaring the production issue resolved.

The migration was applied and exercised on isolated Postgres. A transactional
scratch drop/recreate/rollback preserved the original fixture rows and verified
runtime grants. Production rollback keeps the additive table and rolls back API
and mobile code together; dropping the table would erase pending jobs and results
and requires separate approval. Old clients remain supported during rollout.
