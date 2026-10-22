# ADR 0020: A reviewed corpus for in-house translation

Status: proposed training workflow; existing cloud phrasebook verified in production.

## Context and decision

Roamie already saves cloud translation pairs through the authenticated API for
Talk, Text and Camera. The product owner wants that corpus to support a future
in-house service. On 2026-10-22, a read-only production check found 384 variants,
all linked through contribution ownership, including 100 flagged for review.
This is evidence that storage works, not evidence of a trained model or a
sufficient training dataset. No personal text or account identifiers were
exported during this check.

Retain the existing phrasebook as the collection source; do not create another
service or write every translation synchronously. ADR 0016's envelope remains
20 writes/s peak, 5 lookups/s, approximately 1 KB/variant and 1 GB/million rows.
The existing 150 ms lookup budget and two concurrent background writes per pod
keep corpus work outside translation latency. Failed/busy writes may be dropped;
this corpus is best effort, not an exhaustive event log.

Keep on-device translation private, including when the phone later reconnects.
The 1.0.3 release does not upload local results for training. The collection
choice presented to the product owner distinguishes existing consented cloud
examples from a separate optional offline-contribution feature. The latter
needs its own disclosure and permission before implementation. Permission to
process an AI request is not a blanket approval to train on all conversation
partners' speech. Never retain raw audio or photos as training data by default.

## Training path

1. Record explicit training permission and source/model/prompt provenance for
   each eligible contribution. Check the applicable provider and dataset rights
   before using cloud-generated answers for training. Do not retroactively mark
   the current corpus as human-reviewed or training-permitted. Existing model
   labels are not sufficient evidence of the exact producing engine on every
   fallback path.
2. Build a review queue for permitted text pairs. Re-run sensitive-content
   checks, exclude deletion requests and withdrawn contributions, and require
   bilingual review/correction before a pair becomes approved. The current
   email/long-number filter is useful but is not full anonymization. Neither
   confidence, repeat count nor `review_required = false` proves correctness.
3. Produce a versioned dataset snapshot from approved records with provenance
   IDs, hashes, license/permission manifest and a revocation manifest. Exclude
   account identifiers from training files while preserving a protected mapping
   for deletion. Split by normalized source/deduplication group before sampling
   train/validation/test so paraphrases and reverse pairs do not leak across
   evaluation sets. Never write customer text into CI fixtures or logs.
4. Fine-tune the original Apache-2.0 Hy-MT2 1.8B weights with a reproducible LoRA
   job, not the inference Q4 file. Pin base, tokenizer, training code and dataset
   revisions. Quantize the evaluated checkpoint to a new GGUF artifact and
   calculate its own byte length/SHA-256. A training job requires a concrete
   compute budget and approved data; no paid GPU resource is provisioned here.
5. Compare against the unchanged base and platform/cloud baselines on English
   ↔ Vietnamese, Thai and Korean. Start with at least 100 independently reviewed
   held-out phrases per direction, including numbers, negation and allergies;
   grow a training corpus separately. Track critical errors, adequacy, latency,
   memory and battery on physical phones. The sample target is an evaluation
   minimum, not a guarantee that training data is sufficient.
6. Publish a signed, versioned candidate only after those checks. Download and
   verify it through the existing catalog flow. Never mutate installed model
   weights after individual translations. Keep the previous model available for
   rollback and require explicit approval for the production rollout.

## Privacy, failure and deletion

The trust boundary is between a traveller's content, the authenticated Roamie
API/Postgres, restricted reviewers and a controlled training job. Existing
ownership enables account-data deletion; any new dataset/model release must
also track withdrawals, dataset retirement and, where needed, retraining from
remaining permitted data. Deleting a database row does not unlearn a deployed
model. Document backup expiry and this limitation before collecting training
permission. A failed review/export/training job leaves the serving model and
translation path unchanged. No new schema migration or production mutation
was performed for this decision.

Rejected: online self-training on every answer, which reinforces provider/model
errors, has unbounded privacy/provenance risk and cannot be rolled back per
utterance; silently syncing offline text, which breaks the offline privacy
promise; treating the phrasebook cache as a reviewed training set; and training
from scratch on the present small corpus.

References: ADR 0016, ADR 0017, ADR 0019;
https://huggingface.co/tencent/Hy-MT2-1.8B (model card, license and training code).
