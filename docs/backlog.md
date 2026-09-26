# Backlog conventions

The Roamie backlog follows the same model as the other tesserix planning repositories
(`tesserix/devai`, `tesserix/TripBaba`, `tesserix/hms`). Every work item is a GitHub issue in this repository.
Each one is written with the engineering-story template, classified by labels, and tracked
on one org-level project board.

**Board:** not verified. The 25 September planning snapshot recorded missing GitHub
Projects permission; current token scopes and board state have not been rechecked.
Do not treat a placeholder board URL as an existing project.

**Historical delivery plan:** [epics, stories, dependencies and release gates](archive/2026-09-25/delivery-plan.md).
This records the original release priorities, not current implementation status.
The [GitHub milestones](https://github.com/tesserix/roamie/milestones) and native epic
sub-issues provide usable tracking while project-board access is unavailable.

Reference conventions: [DevAI phased epic](https://github.com/tesserix/devai/issues/192),
[TripBaba fields and story template](https://github.com/tesserix/TripBaba/blob/main/docs/backlog.md),
and [HMS dependency waves and phase gates](https://github.com/tesserix/hms/blob/main/docs/sdk/rollout-plan.md).

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
| **MVP** | MVP 0 Foundations · MVP 1 Travel Mate v1 · MVP 2 AI Companion & connected spending · Later (uncommitted) |
| **Epic** | mirrored by the `epic:` label |
| **Product** | Platform · Talk · Wallet · Nearby · SOS · Companion |

## MVP phasing

| Value | Contents |
|---|---|
| MVP 0: Foundations | ADRs, app shell, API contracts, on-device storage, social customer identity, Vertex gateway, CI, privacy baseline and language/country launch matrix |
| MVP 1: Travel Mate v1 | Talk (1:1 auto-detect), typed/offline fallbacks, manual budget and local alerts, preferences/Nearby, verified offline SOS, privacy controls and release validation |
| MVP 2: AI Companion & connected spending | ADK runtime, read-only MCP tools, companion, daily brief, budget coach, optional group Talk, read-only bank linking and receipt scanning |
| Later: Payments and commerce | P3, uncommitted discovery only: payments, bookings, transfers and bill splitting; no implementation authorised by the backlog item |

Current classification: P0 foundations, P1 core travel, P2 optional expansion, P3 deferred
commerce. Bank integrations and receipt automation cannot block V1. Severity of a newly
found safety defect is assessed separately; an MVP label must never down-rank a critical
security fix. Roamie stays free with social sign-in. Local wallet data is account-scoped; the API
stores verified accounts, shared trip records and personal travel preferences.

## Labels

| Prefix | Values |
|---|---|
| `type:` | `epic`, `feature`, `planning` (RFC/ADR), `spike` (time-boxed, the output is a decision) |
| `product:` | `Platform`, `Talk`, `Wallet`, `Nearby`, `SOS`, `Companion` |
| `area:` | `backend`, `mobile`, `ai`, `data`, `infra` |
| `epic:` | one per epic, matching the Epic board field |
| `mvp:` / `priority:` | mirror the board fields so they remain filterable without the board |
| `team:` | owning role: platform, identity-security, ai, backend, mobile, data, design or sre |

Each story has exactly one type, product, owning team, epic, MVP and priority label.
Epics also carry the `epic` label and native child relationships. Each child has one
parent epic and explicit `Blocked by` issue links; native dependency relationships
mirror those links. Parent epics can span releases: the child's milestone controls
its release, not the parent's milestone.

## Ready and Done

A story enters Ready only when its scope, failure scenario, dependencies, owner role
and release are clear. It enters Done only with the actual acceptance evidence and
the template's engineering checks complete. Scaffolded endpoints or passing unit
tests alone do not complete a traveller journey.

Target project views are a backlog table, status board, MVP grouping and epic grouping.
Use the Status values above; board metadata must mirror issue labels and milestones.
