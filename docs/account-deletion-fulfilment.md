# Roamie account-deletion fulfilment

Owner: sales@tesserix.app. The product owner approved manual fulfilment and email
confirmation within 30 days on 21 October 2026. An in-app submission is sufficient;
do not require the customer to email, call, or justify the request again.

The API records a pending request, not a completed deletion. The runtime role
cannot delete the queue or mark requests complete. Support checks pending requests
every working day and escalates anything approaching its original due date.
Queue outages or failed writes must not show a successful acknowledgement.

## Daily queue

Use the existing authorized database access procedure and a read-only transaction.
Do not put contact details, tokens, document contents or query results into logs,
Git, issue comments or shared screenshots.

```sql
SELECT id, subject, issuer, contact_email, requested_at, due_at
FROM account_deletion_requests
WHERE status = 'pending'
ORDER BY due_at, id;
```

## Fulfil one verified request

1. Select the request by its UUID. Its verified JWT subject and issuer establish
   ownership; use the verified contact email to communicate. Confirm the scope is
   Roamie. Capture a restricted, time-limited recovery record before an approved
   destructive operation, under the production working agreements.
2. Revoke Roamie access/grants and active sessions using the identity service's
   supported administration process; coordinate Sign in with Apple token
   revocation if applicable. Preserve access to other Tesserix products and the
   user's Google/Apple account. Drain outstanding requests and planning jobs before
   deleting data so a delayed write cannot recreate it.
3. Inventory account profile, personal trip profiles/planning jobs, translation
   contributions, document reservations/uploads/jobs, support records and processor
   usage associated with this subject. Use `phrasebook_contributions.subject` and
   `ocr_resources.subject`, not names or photo hashes shared across customers.
   OCR reservations exist even when a provider response was lost: recover the exact
   upload/job with the stored `request_key` plus `-u`/`-j` idempotency suffixes.
4. Remove this customer's private data. For shared groups, remove/anonymize their
   identifying details, authored personal content and invitations while preserving
   other participants' accounts and records. Review free text and shared itinerary
   documents; deleting only membership or only the account row is insufficient.
5. Lock contributed phrase rows before removing contribution links. Remove their
   links and delete phrase text with no remaining independent contributor. Do not
   delete another traveller's independently contributed data. In-memory caches
   are per customer and expire; invalidate them on all replicas before confirming.
6. Delete exact OCR resources with the processing service's supported administrative
   process, including originals, derived pages, results and database content.
   Verify each provider receipt. Never purge the whole product tenant to satisfy
   one person's request. Coordinate deletion with Google Cloud/AI gateway, TypeSafe
   JEV and identity/support processors as needed; record their retention outcome.
7. Apply only actual, documented legal/security retention exceptions. Explain the
   data category, reason, restriction and expiry to the customer. Append-only audit
   triggers are not permission to retain personal identifiers indefinitely: arrange
   the approved privileged retention/purge procedure when no exception applies.
   CNPG is configured for seven-day backups. OCR object lifecycle is one day for
   quarantine/pages and seven days for source/results, followed by seven days of
   GCS soft-deletion recovery. Verify the current settings and deletion outcome;
   lifecycle configuration alone is not proof that a particular file was erased.
8. Check absence across owned stores and processor acknowledgements. Record only
   the minimum restricted fulfilment evidence. Email the verified address confirming
   what was removed, the completion date, and any required exception/expiry. Explain
   that local app data on each device and exported/shared copies require separate
   removal by their holder. Do not claim copies outside Roamie's control were erased.
9. Mark the request completed with an operator-only completion reference after all
   required work and confirmation. Remove contact/identity data from the fulfilment
   record under the approved retention policy. Keep no unnecessary personal data in
   the recovery capture or confirmation evidence. A filled `completed_at` alone is
   not evidence that steps 2–8 happened.

## Release gates

The tested local implementation adds request initiation and ownership tracking; it
does not run the destructive steps above automatically. Before production review:

- Deploy both additive migrations and the corresponding API through GitOps, after
  specific production approval. Preserve the queue/schema on code rollback.
- Verify support's daily queue access and a complete disposable-account fulfilment
  drill, including provider cleanup, identity grants and confirmation.
- Resolve the pre-ownership corpus: read-only discovery found 131 unlinked
  `phrasebook` rows on 21 October. New code excludes unlinked rows from recall.
  After all replicas use ownership tracking, recount, capture a protected recovery
  record and remove only rows with no contribution under separate scoped approval.
  The additive migrations intentionally perform no legacy deletion.
- Rebuild and upload a new iOS binary with consent and deletion UI, attach that
  exact build, verify reviewer access, and then submit. Uploaded build 14 predates
  these fixes and must not be described as containing them.

No production deletion or rollout has been executed by this local implementation.
