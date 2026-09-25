# Backlog conventions

The Roamie backlog follows the same model as the other tesserix planning repositories
(`tesserix/TripBaba`, `tesserix/hms`). Every work item is a GitHub issue in this repository.
Each one is written with the engineering-story template, classified by labels, and tracked
on one org-level project board.

**Board:** [Roamie — Travel Mate](BOARD_URL) (private, org-scoped)

## Issue template

All issues use [`.github/ISSUE_TEMPLATE/engineering-story.md`](../.github/ISSUE_TEMPLATE/engineering-story.md),
which runs Situation → Task → Acceptance Criteria (primary, failure, edge cases) →
Engineering Guardrails → Pull Request Evidence → Definition of Done → Exceptions. The
failure scenario is mandatory.

## Board fields

| Field | Values |
|---|---|
| **Status** | Backlog · Ready · In Progress · In Review · Blocked · Test · Security Review · Done |
| **Priority** | P0 Platform critical · P1 MVP core · P2 Expansion · P3 Later |
| **MVP** | MVP 0 Foundations · MVP 1 Travel Mate v1 · MVP 2 AI Companion |
| **Epic** | mirrored by the `epic:` label |
| **Product** | Platform · Talk · Wallet · Nearby · SOS · Companion |

## MVP phasing

| Value | Contents |
|---|---|
| MVP 0: Foundations | ADRs, app shell, API scaffold, auth, Vertex AI gateway, CI, privacy baseline, spikes |
| MVP 1: Travel Mate v1 | Talk (1:1 auto-detect), Wallet (budget, read-only link, receipts, alerts), Profile and Nearby, SOS |
| MVP 2: AI Companion | ADK agent runtime, MCP tools over Roamie data, companion chat, daily brief, budget coach, group Talk |

Priority and MVP must agree: P0 sits in MVP 0, P1 in MVP 1, and P2 or P3 in MVP 2.

## Labels

| Prefix | Values |
|---|---|
| `type:` | `feature`, `planning` (RFC/ADR), `spike` (time-boxed, the output is a decision) |
| `product:` | `Platform`, `Talk`, `Wallet`, `Nearby`, `SOS`, `Companion` |
| `area:` | `backend`, `mobile`, `ai`, `data`, `infra` |
| `epic:` | one per epic, matching the Epic board field |
| `mvp:` / `priority:` | mirror the board fields so they remain filterable without the board |
