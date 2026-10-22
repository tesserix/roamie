# ADR 0016: Translation phrasebook

Account-unlinked storage below is superseded by ADR 0017 for public release.

Every translation was discarded after its response, so Roamie paid for the same
phrase again for each traveller and kept no record of how it translated. The
product owner wants every translation kept, attributed to its surface, languages
and model, reused for faster answers, and grown into Roamie's own corpus.

Production served about ten conversation turns in the week to 20 October 2026.
Planning envelope for public release: 20 stored translations/s at peak and
5 lookups/s; median source under 100 characters, maximum 5,000. A stored variant
costs about 1 KB with indexes, so one million variants use about 1 GB of the
cluster's 30 GiB. Plan partitioning or archival before five million rows.

Store one row per distinct surface, source language, target language, prompt
version, model, normalised source and translation in the Roamie database. A
repeat increments `uses` and `last_seen`; a different answer for the same source
is a separate variant, so the most-used variant is the settled translation.
Surfaces are `talk` (spoken and typed turns), `text` and `sign` (photo lines).
Same-language turns, empty results, recent context, audio and images are never
stored, and no row references a customer. An entry is skipped when any field
looks like a card, phone or account number (nine or more digits, allowing
spaces, dots, dashes, slashes, brackets and plus) or an email address.

Writes never delay or fail a translation: each is a detached task, at most two
in flight per pod (of its ten connections), dropped when that limit is reached
or the database errors. Lookups serve text translation only, after the in-memory
cache misses and the source is known, within 150 ms, otherwise the model
answers. Only the most-used variant from the current `PROMPT_VERSION`, without a
review flag and used at least three times, is served, so a one-off sentence
never reaches another traveller. A faster answer still shows that a phrase was
translated before, but never by whom. Conversation turns are not served from
the phrasebook: speech must be heard first, and a turn depends on recent context
and speaker direction. Bump `PROMPT_VERSION` whenever a translation prompt
changes; older variants remain but are no longer served.

The runtime role may select, insert and update, but not delete or alter, the
table. No endpoint lists the phrasebook; a traveller only receives the answer to
the exact text they sent. Analysis and exports use the database owner role
under the existing CNPG access controls.

Free text can still name people or places, and an unlinked row cannot be found
for an account-deletion request. The privacy policy says both; store data-safety
declarations must be updated before release. Production migration needs
explicit approval and runs through the existing pre-rollout migration job.

Rejected: an append-only event per translation linked to the customer, which
grows with every request and ties content to accounts; Valkey or memory only,
which does not persist; and a separate service, which would share this data
owner and failure domain. Rollback reverts the API image; the additive table is
kept, and dropping it erases the corpus and needs separate approval.
