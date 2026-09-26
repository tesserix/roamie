# Roamie: architecture (MVP 0–2)

## Implementation boundary

The diagrams and detailed flows below describe the original target architecture,
including planned streaming speech, bank ingestion, notifications and emergency-data
updates. They are not a claim that those integrations are running.

The current app uses social customer authentication, a Rust API and PostgreSQL.
Accounts, shared trip records, audit history and personal travel preferences have
server-side storage. The mobile wallet and conversation state remain local and
account-scoped. Trip-manager requests use the saved profile revision, not a trusted
client snapshot. See [customer identity](adr/0006-customer-identity-and-audit.md),
[database runtime](adr/0005-cnpg-runtime.md) and [manager identity](trip-manager-identity.md).

The [historical delivery plan](archive/2026-09-25/delivery-plan.md) records the original
release priorities. Bank linking and financial automation are independently gated;
payments, transfers and booking execution remain deferred.

## Target shape

```
Expo app (iOS/Android)
   │  HTTPS + WebSocket (Talk streaming)
   ▼
roamie-api (Rust, axum + tokio, modular monolith)
   ├── talk      → ai gateway → Speech-to-Text v2 (Chirp, auto language) → Gemini → Text-to-Speech
   ├── wallet    → aggregator adapter (Basiq | Plaid | TrueLayer | Setu), FX, budget engine
   ├── nearby    → Google Places API (New), ranking by profile + budget
   ├── sos       → versioned emergency dataset (also bundled in the app)
   ├── profile   → language, trip, diet, nationality, contacts
   └── notify    → Expo push
   │
   ├── PostgreSQL (CNPG), with the schema in tesserix-k8s db-schema-bootstrap
   └── NATS JetStream (transaction.ingested → budget evaluation → alert)

MVP 2: roamie-agents (Python, ADK base image) ──MCP──▶ roamie-api tools
```

- **One Rust service** (axum, tokio, sqlx) for MVP 0–1, chosen for low latency on the Talk
  path and a small memory footprint. Modules own their tables. A module is split into a
  separate service only when it has a different scaling or failure profile.
- **Social customer identity.** Native Zitadel clients use authorization code + PKCE.
  The API verifies access tokens and UserInfo; refresh tokens remain in SecureStore.
  Google is offered on both platforms and Apple on iOS. App Attest/Play Integrity and
  customer abuse limits are separate backlog work. Any future bank consent must be
  bound to the verified customer.
- **Delivery** follows the house path of CI → GHCR → GAR → Kargo → ArgoCD. Schemas live
  in this repository under `services/api/migrations`; infrastructure is managed through
  the owning GitOps repository. Migration and production rollout are separate actions.

## Vertex AI gateway

Every model call goes through one `ai` module in roamie-api:

- Workload identity to Vertex AI in `asia-south1`, with no keys in the app
- Model IDs and prompt versions set in config and pinned per release
- Per-user rate limits, a per-trip cost meter, and a timeout on every call, with a typed
  fallback
- Structured output (JSON schema) for anything code consumes, such as receipts and ranking
  reasons
- No PII in prompts beyond what the task needs. Conversation audio is never retained
  server-side.

MVP 2 agents reuse this gateway's policies through ADK's Vertex integration and reach
Roamie data **only through MCP tools**, never through direct DB access.

## Flow: Talk (1:1 auto-detect)

```
mic chunk ─▶ STT v2 streaming (language_codes = [mine, partner, country default])
          ─▶ final transcript + detected language + confidence
          ─▶ direction = detected == mine ? mine→partner : detected→mine
          ─▶ Gemini translate (last 6 turns as context, register: polite/spoken)
          ─▶ TTS in the target language ─▶ app renders both halves + plays audio
          ─▶ if detected != mine: partner := detected
```

- The conversation state (`mine`, `partner`, and the last N turns) lives on the device.
  The server is stateless per turn.
- A low-confidence detection returns candidate languages. The app shows the
  correction chip.
- A spike (MVP 0) will compare STT v2 + Gemini against the Gemini Live native-audio API
  on latency, detection accuracy, and cost before the pipeline is locked.

## Flow: spend to alert

```
aggregator webhook / receipt / manual ─▶ normalise (amount_minor int64, currency, FX-at-date)
   ─▶ dedupe (provider txn id | receipt hash) ─▶ JetStream transaction.ingested
   ─▶ budget engine: recompute totals, evaluate 50/80/100% per budget+category
   ─▶ alert emitted once per (budget, category, threshold) ─▶ Expo push
```

- Money is always stored as integer minor units, with no floats. The FX rate is stored
  with the transaction and is never recomputed after the fact.
- Aggregator tokens are held server-side in Secret Manager or KMS. They are read-only
  consents with an expiry and can be revoked from the app.
- Only transactions dated within the trip window are counted by default. The user can
  include or exclude individual transactions.

## Flow: Nearby

- Places search runs through roamie-api, which keeps the API key off the device and
  caches results briefly by location cell.
- Ranking is deterministic: hard filters come first (open now, allergy exclusions where
  known, and the price ceiling from the remaining daily budget), then a score. Gemini only
  writes the short *why it matches* line from structured fields.

## Flow: SOS

- The `emergency-numbers` dataset is a versioned JSON file with an ISO country code,
  service type, number, source URL, and `verified_at` for each entry. Changes go through
  PR review.
- The app bundles the latest dataset and refreshes it in the background. The SOS screen
  never waits on the network.
- Embassy lookup is keyed by (nationality, current country).
