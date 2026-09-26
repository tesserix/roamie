# Roamie delivery plan — historical snapshot

> Archived on 27 September 2026. This preserves the original issue plan, not current implementation or live GitHub status. The account-free, device-only, four-tab assumptions below were superseded by [customer identity and audit](../../adr/0006-customer-identity-and-audit.md), [stored trip profiles](../../trip-manager-identity.md), and the Trips UI. Use [current backlog conventions](../../backlog.md) for ongoing work. The adjacent JSON files are historical planning evidence, not current verification.

Updated 25 September 2026. This is a delivery backlog, not a claim that the app is implemented or release-ready.

## Product boundary

Roamie is a free, account-free travel companion. Keep four tabs: Talk, Wallet, Nearby and SOS. Set the traveller's language once; confidently detected partner speech translates into it, and the traveller's reply goes to the last confirmed partner language. V1 is one-to-one only. Unknown speech never silently changes that state.

Preferences, trips, budgets, expenses and conversations live on-device. A verified installation session protects paid upstream APIs without a login screen; an installation ID alone is not authentication. Vertex calls remain server-side, bounded and free of retained raw conversation audio.

Dietary suggestions are evidence-based, never guarantees. Emergency numbers and phrases come from reviewed data, not model memory. Location uncertainty is visible. Money uses deterministic arithmetic and integer minor units.

The user's priority decision moves financial automation behind the core travel experience. Read-only bank data is distinct from payment capability. Payments, bookings, transfers and bill splitting are uncommitted P3 discovery, not V1 or MVP 2 delivery work.

## References actually inspected

- [DevAI #192](https://github.com/tesserix/devai/issues/192): parent epics, phased child checklists, explicit sequencing and guardrails.
- [TripBaba conventions](https://github.com/tesserix/TripBaba/blob/main/docs/backlog.md): story template, mandatory failure scenarios, Status/Priority/MVP/Epic/Product fields and ownership labels.
- [HMS rollout gates](https://github.com/tesserix/hms/blob/main/docs/sdk/rollout-plan.md): dependency waves and evidence-based phase exits. HMS also uses repository milestones; DevAI had no repository milestones in the inspected response.

GitHub Projects field/view comparison remains blocked by missing `project` scope. Do not describe the board as created until its URL, fields and items have been verified.

## Releases

| Release | Stories | Scope and gate |
|---|---:|---|
| [MVP 0 — Foundations](https://github.com/tesserix/roamie/milestone/1) | 12 | API/app/local storage, installation security, privacy, measured Vertex language support and build pipeline. No bank-provider dependency. |
| [MVP 1 — Travel Mate v1](https://github.com/tesserix/roamie/milestone/2) | 30 | One-to-one Talk, manual budget/local alerts, preferences/Nearby, verified offline SOS, privacy controls and iOS/Android beta. No financial-automation blocker. |
| [MVP 2 — Companion & connected spending](https://github.com/tesserix/roamie/milestone/3) | 17 | Read-only agent tools, companion/dinner/budget agents, opt-in local memory and daily brief. Bank links, receipts and group Talk each have independent gates. |
| [Later — uncommitted](https://github.com/tesserix/roamie/milestone/4) | 1 | Assess future commerce only after core validation; explicit new scope required before implementation. |

Priority labels are P0/P1/P2/P3 respectively. Defect severity is assessed separately; a release label never excuses a critical safety issue. An epic spanning releases is not an earlier-release blocker merely because some later children remain open.

## Epics

Every delivery story has exactly one native parent epic. Parent checklists show the release split; child milestones and blocker relationships control implementation order.

| Epic | Parent | Child stories |
|---|---|---:|
| Platform & Foundations | [#32](https://github.com/tesserix/roamie/issues/32) | 6 |
| Privacy & Security | [#33](https://github.com/tesserix/roamie/issues/33) | 3 |
| Vertex AI Gateway | [#34](https://github.com/tesserix/roamie/issues/34) | 2 |
| Talk | [#35](https://github.com/tesserix/roamie/issues/35) | 10 |
| Wallet & Budget | [#36](https://github.com/tesserix/roamie/issues/36) | 11 |
| Profile & Nearby | [#37](https://github.com/tesserix/roamie/issues/37) | 5 |
| SOS & Safety | [#38](https://github.com/tesserix/roamie/issues/38) | 5 |
| Design & UX | [#39](https://github.com/tesserix/roamie/issues/39) | 2 |
| Release & Reliability | [#40](https://github.com/tesserix/roamie/issues/40) | 4 |
| AI Companion | [#41](https://github.com/tesserix/roamie/issues/41) | 11 |
| Payments & Commerce (Deferred) | [#42](https://github.com/tesserix/roamie/issues/42) | 1 |

## Delivery order

1. Agree topology/privacy and benchmark speech; establish app/API/local-store contracts and installation security.
2. Implement translation direction/confidence/audio lifecycle, local trip and budget flows, verified emergency data and nearby matching.
3. Test offline recovery, permissions, safety, accessibility, privacy and deterministic money. Complete V1 operational and beta gates.
4. Build the bounded agent runtime/tools/evals over explicitly shared trip context. Add optional bank links and receipts without changing the no-payment boundary.
5. Certify companion, connected spending and group translation independently. Keep payments deferred.

The complete story graph was checked for cycles and dependencies on a later phase before publication. Native GitHub dependencies mirror the Blocked by lists; no fake dependency on an entire epic is used.

## Complete story map

### MVP 0 — Foundations

| Story | Epic | Blocked by |
|---|---|---|
| [#1](https://github.com/tesserix/roamie/issues/1) [Planning] ADR: Roamie service topology (Rust backend), stack and repo layout | Platform & Foundations | None |
| [#2](https://github.com/tesserix/roamie/issues/2) [Spike] Talk pipeline: STT v2 + Gemini vs Gemini Live native audio | Talk | [#1](https://github.com/tesserix/roamie/issues/1) |
| [#4](https://github.com/tesserix/roamie/issues/4) [Platform] Expo app shell with four-tab navigation and first-run setup | Platform & Foundations | [#1](https://github.com/tesserix/roamie/issues/1) |
| [#5](https://github.com/tesserix/roamie/issues/5) [Platform] roamie-api Rust (axum) scaffold, health, config and observability | Platform & Foundations | [#1](https://github.com/tesserix/roamie/issues/1) |
| [#6](https://github.com/tesserix/roamie/issues/6) [Platform] Anonymous install identity and API abuse protection (no sign-in) | Platform & Foundations | [#5](https://github.com/tesserix/roamie/issues/5), [#8](https://github.com/tesserix/roamie/issues/8) |
| [#7](https://github.com/tesserix/roamie/issues/7) [AI] Vertex AI gateway module with quotas, pinned models and fallbacks | Vertex AI Gateway | [#5](https://github.com/tesserix/roamie/issues/5), [#2](https://github.com/tesserix/roamie/issues/2), [#8](https://github.com/tesserix/roamie/issues/8) |
| [#8](https://github.com/tesserix/roamie/issues/8) [Planning] Privacy baseline: data map, retention and consent | Privacy & Security | [#1](https://github.com/tesserix/roamie/issues/1) |
| [#9](https://github.com/tesserix/roamie/issues/9) [Platform] CI, Kargo and ArgoCD delivery path for roamie-api | Release & Reliability | [#4](https://github.com/tesserix/roamie/issues/4), [#5](https://github.com/tesserix/roamie/issues/5) |
| [#43](https://github.com/tesserix/roamie/issues/43) [Platform] Versioned API contracts and mobile integration tests | Platform & Foundations | [#1](https://github.com/tesserix/roamie/issues/1), [#5](https://github.com/tesserix/roamie/issues/5) |
| [#44](https://github.com/tesserix/roamie/issues/44) [Platform] Durable on-device trip storage and migration boundaries | Platform & Foundations | [#1](https://github.com/tesserix/roamie/issues/1), [#8](https://github.com/tesserix/roamie/issues/8) |
| [#45](https://github.com/tesserix/roamie/issues/45) [Security] Bind anonymous API requests to verified installations | Privacy & Security | [#6](https://github.com/tesserix/roamie/issues/6), [#43](https://github.com/tesserix/roamie/issues/43), [#44](https://github.com/tesserix/roamie/issues/44) |
| [#46](https://github.com/tesserix/roamie/issues/46) [Planning] Agree launch countries, languages, bank coverage and service budgets | Vertex AI Gateway | [#2](https://github.com/tesserix/roamie/issues/2) |

### MVP 1 — Travel Mate v1

| Story | Epic | Blocked by |
|---|---|---|
| [#10](https://github.com/tesserix/roamie/issues/10) [Talk] Streaming speech pipeline with automatic language detection | Talk | [#2](https://github.com/tesserix/roamie/issues/2), [#7](https://github.com/tesserix/roamie/issues/7), [#43](https://github.com/tesserix/roamie/issues/43), [#45](https://github.com/tesserix/roamie/issues/45) |
| [#11](https://github.com/tesserix/roamie/issues/11) [Talk] Conversation direction: mine vs last partner language | Talk | [#43](https://github.com/tesserix/roamie/issues/43) |
| [#12](https://github.com/tesserix/roamie/issues/12) [Talk] Gemini contextual translation and text-to-speech | Talk | [#7](https://github.com/tesserix/roamie/issues/7), [#11](https://github.com/tesserix/roamie/issues/11), [#46](https://github.com/tesserix/roamie/issues/46) |
| [#13](https://github.com/tesserix/roamie/issues/13) [Talk] Face-to-face split screen with one mic button | Talk | [#4](https://github.com/tesserix/roamie/issues/4), [#10](https://github.com/tesserix/roamie/issues/10), [#11](https://github.com/tesserix/roamie/issues/11), [#12](https://github.com/tesserix/roamie/issues/12) |
| [#14](https://github.com/tesserix/roamie/issues/14) [Talk] Offline phrase pack and allergy card | Talk | [#20](https://github.com/tesserix/roamie/issues/20), [#46](https://github.com/tesserix/roamie/issues/46) |
| [#15](https://github.com/tesserix/roamie/issues/15) [Wallet] Trip budget with categories and home currency | Wallet & Budget | [#47](https://github.com/tesserix/roamie/issues/47), [#44](https://github.com/tesserix/roamie/issues/44) |
| [#18](https://github.com/tesserix/roamie/issues/18) [Wallet] Manual expense entry and FX conversion at transaction date | Wallet & Budget | [#15](https://github.com/tesserix/roamie/issues/15), [#49](https://github.com/tesserix/roamie/issues/49) |
| [#19](https://github.com/tesserix/roamie/issues/19) [Wallet] Budget alerts and daily pace nudges | Wallet & Budget | [#15](https://github.com/tesserix/roamie/issues/15), [#50](https://github.com/tesserix/roamie/issues/50) |
| [#20](https://github.com/tesserix/roamie/issues/20) [Nearby] Preference profile: diet, allergies, budget level, interests | Profile & Nearby | [#4](https://github.com/tesserix/roamie/issues/4), [#6](https://github.com/tesserix/roamie/issues/6), [#44](https://github.com/tesserix/roamie/issues/44) |
| [#21](https://github.com/tesserix/roamie/issues/21) [Nearby] Real-time nearby places ranked by profile and remaining budget | Profile & Nearby | [#7](https://github.com/tesserix/roamie/issues/7), [#20](https://github.com/tesserix/roamie/issues/20), [#15](https://github.com/tesserix/roamie/issues/15), [#47](https://github.com/tesserix/roamie/issues/47) |
| [#22](https://github.com/tesserix/roamie/issues/22) [Nearby] 'Why it matches' line and Maps handoff | Profile & Nearby | [#21](https://github.com/tesserix/roamie/issues/21) |
| [#23](https://github.com/tesserix/roamie/issues/23) [SOS] Verified emergency numbers dataset with sources | SOS & Safety | [#46](https://github.com/tesserix/roamie/issues/46) |
| [#24](https://github.com/tesserix/roamie/issues/24) [SOS] Offline SOS screen for the current country with one-tap dial | SOS & Safety | [#4](https://github.com/tesserix/roamie/issues/4), [#23](https://github.com/tesserix/roamie/issues/23) |
| [#25](https://github.com/tesserix/roamie/issues/25) [SOS] Embassy lookup, share-location and 'Help me say it' | SOS & Safety | [#23](https://github.com/tesserix/roamie/issues/23), [#24](https://github.com/tesserix/roamie/issues/24), [#20](https://github.com/tesserix/roamie/issues/20) |
| [#31](https://github.com/tesserix/roamie/issues/31) [Design] Simple-by-default design system and first-time traveller usability test | Design & UX | [#4](https://github.com/tesserix/roamie/issues/4), [#13](https://github.com/tesserix/roamie/issues/13), [#18](https://github.com/tesserix/roamie/issues/18), [#22](https://github.com/tesserix/roamie/issues/22), [#24](https://github.com/tesserix/roamie/issues/24) |
| [#47](https://github.com/tesserix/roamie/issues/47) [Profile] Create, switch, edit and finish a trip without repeating setup | Profile & Nearby | [#4](https://github.com/tesserix/roamie/issues/4), [#6](https://github.com/tesserix/roamie/issues/6), [#44](https://github.com/tesserix/roamie/issues/44), [#43](https://github.com/tesserix/roamie/issues/43) |
| [#48](https://github.com/tesserix/roamie/issues/48) [Mobile] Recover local drafts and network-dependent operations after interruption | Design & UX | [#47](https://github.com/tesserix/roamie/issues/47), [#20](https://github.com/tesserix/roamie/issues/20), [#18](https://github.com/tesserix/roamie/issues/18) |
| [#49](https://github.com/tesserix/roamie/issues/49) [Wallet] Reject malformed money and preserve exact currency precision | Wallet & Budget | [#15](https://github.com/tesserix/roamie/issues/15), [#43](https://github.com/tesserix/roamie/issues/43) |
| [#50](https://github.com/tesserix/roamie/issues/50) [Wallet] Correct, refund and exclude manual expenses without corrupting totals | Wallet & Budget | [#15](https://github.com/tesserix/roamie/issues/15), [#18](https://github.com/tesserix/roamie/issues/18), [#44](https://github.com/tesserix/roamie/issues/44), [#49](https://github.com/tesserix/roamie/issues/49) |
| [#52](https://github.com/tesserix/roamie/issues/52) [Wallet] Durable local budget alerts and notification preferences | Wallet & Budget | [#19](https://github.com/tesserix/roamie/issues/19), [#50](https://github.com/tesserix/roamie/issues/50), [#44](https://github.com/tesserix/roamie/issues/44) |
| [#53](https://github.com/tesserix/roamie/issues/53) [Talk] Confidence-gated partner language and new-conversation reset | Talk | [#10](https://github.com/tesserix/roamie/issues/10), [#11](https://github.com/tesserix/roamie/issues/11), [#46](https://github.com/tesserix/roamie/issues/46) |
| [#54](https://github.com/tesserix/roamie/issues/54) [Talk] Audio lifecycle, echo prevention and network interruption recovery | Talk | [#10](https://github.com/tesserix/roamie/issues/10), [#12](https://github.com/tesserix/roamie/issues/12), [#13](https://github.com/tesserix/roamie/issues/13), [#53](https://github.com/tesserix/roamie/issues/53) |
| [#55](https://github.com/tesserix/roamie/issues/55) [Talk] Typed conversation and accessible full-screen translation fallback | Talk | [#11](https://github.com/tesserix/roamie/issues/11), [#12](https://github.com/tesserix/roamie/issues/12), [#13](https://github.com/tesserix/roamie/issues/13) |
| [#56](https://github.com/tesserix/roamie/issues/56) [Nearby] Dietary evidence, stale places and transparent no-match recovery | Profile & Nearby | [#20](https://github.com/tesserix/roamie/issues/20), [#21](https://github.com/tesserix/roamie/issues/21), [#22](https://github.com/tesserix/roamie/issues/22), [#47](https://github.com/tesserix/roamie/issues/47) |
| [#57](https://github.com/tesserix/roamie/issues/57) [SOS] Confirm current country and handle denied location or border changes | SOS & Safety | [#23](https://github.com/tesserix/roamie/issues/23), [#24](https://github.com/tesserix/roamie/issues/24), [#47](https://github.com/tesserix/roamie/issues/47) |
| [#58](https://github.com/tesserix/roamie/issues/58) [SOS] Validate dataset updates and preserve reviewed offline safety content | SOS & Safety | [#14](https://github.com/tesserix/roamie/issues/14), [#23](https://github.com/tesserix/roamie/issues/23), [#24](https://github.com/tesserix/roamie/issues/24), [#25](https://github.com/tesserix/roamie/issues/25) |
| [#59](https://github.com/tesserix/roamie/issues/59) [Privacy] On-device export, delete-my-data and consent controls | Privacy & Security | [#8](https://github.com/tesserix/roamie/issues/8), [#6](https://github.com/tesserix/roamie/issues/6), [#44](https://github.com/tesserix/roamie/issues/44) |
| [#61](https://github.com/tesserix/roamie/issues/61) [Quality] End-to-end traveller journeys on iOS and Android | Release & Reliability | [#13](https://github.com/tesserix/roamie/issues/13), [#54](https://github.com/tesserix/roamie/issues/54), [#55](https://github.com/tesserix/roamie/issues/55), [#48](https://github.com/tesserix/roamie/issues/48), [#52](https://github.com/tesserix/roamie/issues/52), [#56](https://github.com/tesserix/roamie/issues/56), [#57](https://github.com/tesserix/roamie/issues/57), [#58](https://github.com/tesserix/roamie/issues/58), [#59](https://github.com/tesserix/roamie/issues/59), [#31](https://github.com/tesserix/roamie/issues/31) |
| [#62](https://github.com/tesserix/roamie/issues/62) [Reliability] Privacy-safe telemetry, service budgets and recovery drills | Release & Reliability | [#5](https://github.com/tesserix/roamie/issues/5), [#7](https://github.com/tesserix/roamie/issues/7), [#9](https://github.com/tesserix/roamie/issues/9), [#46](https://github.com/tesserix/roamie/issues/46), [#52](https://github.com/tesserix/roamie/issues/52) |
| [#63](https://github.com/tesserix/roamie/issues/63) [Release] V1 beta, store readiness and go-live acceptance gate | Release & Reliability | [#61](https://github.com/tesserix/roamie/issues/61), [#62](https://github.com/tesserix/roamie/issues/62), [#46](https://github.com/tesserix/roamie/issues/46), [#59](https://github.com/tesserix/roamie/issues/59) |

### MVP 2 — Companion & connected spending

| Story | Epic | Blocked by |
|---|---|---|
| [#3](https://github.com/tesserix/roamie/issues/3) [Spike] Read-only spend data: aggregator coverage by region | Wallet & Budget | [#1](https://github.com/tesserix/roamie/issues/1) |
| [#16](https://github.com/tesserix/roamie/issues/16) [Wallet] Read-only account link via aggregator adapter | Wallet & Budget | [#3](https://github.com/tesserix/roamie/issues/3), [#6](https://github.com/tesserix/roamie/issues/6), [#44](https://github.com/tesserix/roamie/issues/44), [#45](https://github.com/tesserix/roamie/issues/45) |
| [#17](https://github.com/tesserix/roamie/issues/17) [Wallet] Receipt snap with Gemini extraction | Wallet & Budget | [#7](https://github.com/tesserix/roamie/issues/7), [#18](https://github.com/tesserix/roamie/issues/18) |
| [#26](https://github.com/tesserix/roamie/issues/26) [Planning] ADR: companion agent runtime on ADK and Vertex AI | AI Companion | [#1](https://github.com/tesserix/roamie/issues/1), [#8](https://github.com/tesserix/roamie/issues/8) |
| [#27](https://github.com/tesserix/roamie/issues/27) [Companion] MCP tool surface over profile, wallet, nearby and SOS | AI Companion | [#45](https://github.com/tesserix/roamie/issues/45), [#43](https://github.com/tesserix/roamie/issues/43), [#15](https://github.com/tesserix/roamie/issues/15), [#21](https://github.com/tesserix/roamie/issues/21), [#23](https://github.com/tesserix/roamie/issues/23) |
| [#28](https://github.com/tesserix/roamie/issues/28) [Companion] Trip-aware companion chat | AI Companion | [#64](https://github.com/tesserix/roamie/issues/64), [#65](https://github.com/tesserix/roamie/issues/65) |
| [#29](https://github.com/tesserix/roamie/issues/29) [Companion] Daily brief and proactive budget coach | AI Companion | [#69](https://github.com/tesserix/roamie/issues/69), [#67](https://github.com/tesserix/roamie/issues/67) |
| [#30](https://github.com/tesserix/roamie/issues/30) [Talk] Group conversation: three or more languages | Talk | [#54](https://github.com/tesserix/roamie/issues/54), [#53](https://github.com/tesserix/roamie/issues/53), [#46](https://github.com/tesserix/roamie/issues/46) |
| [#51](https://github.com/tesserix/roamie/issues/51) [Wallet] Recover bank sync, verify callbacks and show honest freshness | Wallet & Budget | [#3](https://github.com/tesserix/roamie/issues/3), [#16](https://github.com/tesserix/roamie/issues/16), [#50](https://github.com/tesserix/roamie/issues/50), [#59](https://github.com/tesserix/roamie/issues/59) |
| [#60](https://github.com/tesserix/roamie/issues/60) [Wallet] Secure receipt capture, extraction and confirmed-save lifecycle | Wallet & Budget | [#17](https://github.com/tesserix/roamie/issues/17), [#49](https://github.com/tesserix/roamie/issues/49), [#8](https://github.com/tesserix/roamie/issues/8) |
| [#64](https://github.com/tesserix/roamie/issues/64) [Companion] Implement Vertex ADK runtime with cancellation and bounded tools | AI Companion | [#26](https://github.com/tesserix/roamie/issues/26), [#27](https://github.com/tesserix/roamie/issues/27), [#7](https://github.com/tesserix/roamie/issues/7), [#63](https://github.com/tesserix/roamie/issues/63) |
| [#65](https://github.com/tesserix/roamie/issues/65) [Companion] Safety, grounding and regression gates for every agent release | AI Companion | [#64](https://github.com/tesserix/roamie/issues/64), [#27](https://github.com/tesserix/roamie/issues/27) |
| [#66](https://github.com/tesserix/roamie/issues/66) [Companion] Find-me-dinner agent grounded in diet, nearby places and budget | AI Companion | [#64](https://github.com/tesserix/roamie/issues/64), [#65](https://github.com/tesserix/roamie/issues/65), [#56](https://github.com/tesserix/roamie/issues/56), [#28](https://github.com/tesserix/roamie/issues/28) |
| [#67](https://github.com/tesserix/roamie/issues/67) [Companion] Budget coach using deterministic balances and spend projections | AI Companion | [#64](https://github.com/tesserix/roamie/issues/64), [#65](https://github.com/tesserix/roamie/issues/65), [#50](https://github.com/tesserix/roamie/issues/50), [#28](https://github.com/tesserix/roamie/issues/28) |
| [#68](https://github.com/tesserix/roamie/issues/68) [Companion] Opt-in on-device memory and explicit per-request context sharing | AI Companion | [#8](https://github.com/tesserix/roamie/issues/8), [#59](https://github.com/tesserix/roamie/issues/59), [#64](https://github.com/tesserix/roamie/issues/64) |
| [#69](https://github.com/tesserix/roamie/issues/69) [Companion] Verified daily-brief data and timezone-safe scheduling | AI Companion | [#64](https://github.com/tesserix/roamie/issues/64), [#65](https://github.com/tesserix/roamie/issues/65), [#52](https://github.com/tesserix/roamie/issues/52) |
| [#70](https://github.com/tesserix/roamie/issues/70) [Release] MVP 2 companion beta and independent group-Talk gate | AI Companion | [#28](https://github.com/tesserix/roamie/issues/28), [#29](https://github.com/tesserix/roamie/issues/29), [#66](https://github.com/tesserix/roamie/issues/66), [#67](https://github.com/tesserix/roamie/issues/67), [#68](https://github.com/tesserix/roamie/issues/68), [#65](https://github.com/tesserix/roamie/issues/65) |

### Later — uncommitted

| Story | Epic | Blocked by |
|---|---|---|
| [#71](https://github.com/tesserix/roamie/issues/71) [Later] Assess payments, bookings and bill splitting only after core travel validation | Payments & Commerce (Deferred) | [#63](https://github.com/tesserix/roamie/issues/63), [#70](https://github.com/tesserix/roamie/issues/70) |

## Review findings incorporated into stories

- The early money parser accepted `12abc34` as USD 1,234 and Unicode-negative `−5.00` as positive USD 5. Two isolated regression probes reproduced the issue; #49 owns correction and coverage.
- Low-confidence language detection could corrupt the partner state; #53 makes state changes conditional and documents the limit of language-only speaker inference.
- The original 31 Result sections copied unrelated trip-generation outcomes. They were replaced with story-specific outcomes and primary-scenario evidence.
- Earlier draft contradictions are explicitly corrected in existing issues: no login/cloud profile requirement, no unreviewed medical-phrase fallback, no exact bank purchase-time latency promise, no silent allergy relaxation, no automatic location sharing and no mandatory fifth tab.
- Claude changed the implementation during this review. The first observed Rust snapshot had five passing unit tests, but failed formatting and strict Clippy; mobile typecheck could not start because dependencies were absent. Those results describe that snapshot, not certification of the newer implementation.

## Project board completion

The repository issues, milestones, native parent relationships and blockers can be managed with current repository access. Creating or comparing org Projects requires the `project` scope. Authenticate using `gh auth refresh -h github.com -s project`, then:

1. Inspect the existing DevAI/TripBaba/HMS project fields and views; find any existing Roamie board before creating one.
2. Link the private Roamie project to `tesserix/roamie`; use Status, Priority, MVP, Epic and Product fields from [current backlog conventions](../../backlog.md).
3. Add all epics and stories, mirror release/priority/epic/product labels, and retain honest implementation status (no automatic Done from scaffold commits).
4. Provide backlog-table, status-board, MVP and epic views. Verify item count and metadata against the issue manifest, then record the real board URL.

## Acceptance evidence

Every story uses the engineering-story template with scope, concrete primary/failure scenarios, edge cases, engineering checks and completion evidence. Human assignment is not fabricated: `team:` identifies the owning role until a maintainer assigns an individual. No production rollout, migration, payment integration or emergency call is authorised by issue creation.
