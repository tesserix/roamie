# Production readiness — 12 October 2026

**Status: validated implementation candidate; not approved or deployed to production.**
Roamie is installed on isolated iOS and Android simulators. Docker/CI/mobile release
configuration and the OCR/JEV/gateway/console paths have been hardened and tested.
Production gateway activation, OpenBao credential copying, real customer sign-in,
external TestFlight review and complete physical-device validation remain outstanding.
No commits, pushes, PRs, tags, public releases or production backend rollout were made.
At the user's request, the Apple bundle was registered and EAS signing/submission
credentials were configured using existing Tesserix credentials and a new Roamie
provisioning profile. No existing credential was rotated. iOS 0.1.0 (2) was
uploaded and processed successfully; Samyak and Mahesh are invited to internal
TestFlight. External testers have build 3 assigned and are waiting for Apple's
beta review approval before they can install.

## Public API connection — 20 October 2026

**Configuration fixed and validated; authenticated spoken acceptance pending.**

The promotion emulator had been launched with a loopback API override and local
authentication disabled, without a local API server. It now uses the public API
with Zitadel authentication enabled. Ordinary development launches also default
to `https://roamie-api.tesserix.app`; local API/auth bypass requires explicit
configuration. Existing EAS device profiles already specify the public API.

Public readiness, sign-in configuration and OIDC discovery returned HTTP 200.
Protected account and conversation routes returned HTTP 401 without a token.
All 202 mobile tests across 41 suites, TypeScript, clean ESLint and local Android
production JavaScript export passed. Local-only UI test fixtures now explicitly
select a local API instead of relying on an implicit development default.

Eight spoken inputs for English ↔ Vietnamese and Korean ↔ Hindi are prepared.
Reviewer sign-in and actual microphone → authenticated translation → playback
acceptance remain unverified. Physical-device builds have not been rebuilt or
released. [Evidence and speech inputs](../output/mobile-qa/public-api-2026-10-20/verification.json)
record these limits; endpoint reachability is not a completed conversation test.

## Hands-free permission startup — 20 October 2026

**DONE in source and Android emulator validation; not released.**

- [x] Fixed granted microphone access reopening Android permission handling and
  canceling hands-free through a background event.
- [x] First-time permission now continues directly to listening. Genuine backgrounding
  still stops recording; returning does not restart it. Explicit Stop also cancels
  delayed permission checks and pending permission requests.
- [x] Removed all temporary on-screen diagnostics.
- [x] 198 tests across 40 suites, TypeScript, clean ESLint and local Android
  production JavaScript export passed.
- [x] Android API 36 emulator verified permission grant, listening, background stop,
  restart and explicit Stop. [Video and screenshots](../output/mobile-qa/handsfree-permission-2026-10-20/verification.json)
  identify the verified source hashes and remaining limits.
- [ ] Rebuild and validate the changed app on a physical device before release.
- [ ] Verify real English ↔ Vietnamese and Korean ↔ Hindi translation with a
  connected API and a confirmed free allowance. This run exercised microphone
  lifecycle only and did not publish a translated-conversation demo.

## Changes delivered

- Shared mobile API transport rejects obsolete account/session responses and prevents
  late 401s from clearing a renewed login. AI/photo deadlines match backend budgets.
- Text translation clears stale output immediately, cancels obsolete calls, supports
  retry and has an accessible large-text display. Uncertain OCR remains visible.
- Wallet loading errors preserve saved data; writes are serialized and failures
  have retry UI. Offline communication cards remain reachable from sign-in.
  Manual expense persistence was verified across an app restart.
- Receipts and statements reuse Document Intelligence OCR, redact card numbers,
  preserve job/review state, obtain a typed JEV verdict and then extract structured
  results. Unsupported generated amounts cannot become saved money. Statement
  rows require user review. Sign translation preserves low/unknown OCR confidence.
- Production generation and JEV now go through a private native `roamie-ai`
  AgentGateway service. Release builds cannot use direct Vertex; the API holds no
  TypeSafe key. Verified customer context is isolated per request. Gateway policy
  checks mobile JWTs and the API workload, removes customer headers before provider
  egress and exports metadata to the existing console AI ledger.
- Talk supports account-scoped, persistent fixed source-language selection and
  `You: Auto`. Accepted conversation turns can update the source and partner pair;
  recent six-turn context and expected turn order assist interpretation. Explicit
  source selection stays fixed, including after an app restart. JEV reviews clarity
  and fidelity; uncertain turns stay visible without automatic speech, history or
  language-memory updates. Typed text remains the authoritative transcript; a
  rewritten model transcript forces review. Current-turn/schema instructions
  separate requested languages from past turns. Clearing cancels pending work.
- Missing device voices use a bounded, ephemeral Gemini 3.8 Flash TTS WAV through
  the private gateway. Odia playback and its spoken content were verified locally.
  Manual playback waits for completion and exposes Stop/retry controls.
- Nearby waits for the permission decision before timing position acquisition,
  distinguishes permanent denial and disabled services, offers retry/settings
  recovery and cancels obsolete searches. Changing location/category removes old
  results immediately. Existing Places integration returned 18 food results for a
  synthetic Melbourne position; iOS displayed food and pharmacy results.
- Talk uses a compact waveform icon labelled Hands-free beside the microphone,
  balanced by a Type shortcut. Active mode has a central Stop control and a
  Hands-free indicator. Shared icons now supply Material names on Android;
  Android no longer reserves duplicate native-tab footer space. Introductory
  content retains its intrinsic height so it can scroll at larger font sizes.
- API/MCP images use reusable digest-pinned Tesserix runtimes, non-root execution,
  restricted build contexts and cached API compilation. The lean MCP image removes
  unused ADK dependencies. Safe SDK/dependency updates preserve Expo compatibility.
- Reusable mobile/MCP checks, manual simulator/device builds, exact-build TestFlight
  submission and version-validated draft releases are included. Image publishing
  does not automatically advance the Kargo deployment branch.

GitOps changes are isolated in
`../roamie-gitops-integration`; unrelated dirty `tesserix-k8s` work was preserved.
The console changes are in a fresh `../roamie-console-integration` checkout.
Roamie is included in the console estate and AI display names; the existing usage
page will expose its product/service traffic after activation. A complete product
admin rail, product KPI endpoint and user-name lookup are **not implemented**.

## Verification performed

| Area | Evidence | Limit |
| --- | --- | --- |
| Mobile | 165 tests in 39 suites; TypeScript and clean lint; all 21 Expo Doctor checks and platform exports | No physical iOS/Android acceptance run |
| API | 106 ordinary tests; strict Clippy, formatting and build; 76.14% line coverage | Seven database tests run separately |
| Database | All seven isolated real-Postgres tests passed; TLS container smoke, migrations, seeds and runtime/schema privilege checks | No production migration or restore drill |
| Media | Actual MP4 render/duration/frame test passed | Physical camera/video paths remain unverified |
| MCP | 14 tests, Ruff, strict mypy, package build and container smoke passed | Connected manager/specialist journeys still need customer acceptance |
| Release | Eight Node release/configuration tests; actionlint; both images built and smoke-tested | EAS/store submissions not run |
| GitOps | 16 gateway/copy/reader/ownership tests; four chart lints; Terraform validation and two tests; installed-CRD server dry-run | Schema validation is not live mesh authorization |
| Gateway | Actual v1.4.1 probe rejected absent/wrong-audience JWTs, replaced a synthetic provider key, removed customer headers and exported Roamie/JEV fields; actual OpenAI text/audio/schema-to-Vertex conversion and native speech metadata export passed | Uses synthetic identity/provider responses, not deployed Roamie mesh |
| Console | 157 console-core tests; 5,406 console tests; typechecks, lints and production build; AI usage package race tests against isolated Postgres | No new production event or full Roamie admin rail |
| Ledger | Captured real-gateway events replayed twice; exactly one event/hourly increment, correct user/service, JEV 40 input/10 output tokens with partial pricing, native speech 12 input/280 output tokens explicitly unpriced | Not a provider invoice or production freshness check |
| Live OCR/JEV | Synthetic receipt returned Cafe Test, AUD 12.50, date 2026-10-12, completed OCR and `jev-1.13.0` | Earlier direct-provider probe; final gateway path needs live acceptance |
| Native iOS | Installed build, onboarding, Bonjour → Hello, large-text display, immediate clearing, communication cards, manual AUD 12.50 expense and restart persistence, camera-denial photo fallback and receipt review/save, location-denial SOS/manual Australia selection; Odia question → English, English reply → Odia with completed playback, fixed source persistence across restart, Nearby denial/retry and real Places food/pharmacy results at synthetic Melbourne coordinates | Uses local development account/API and debug vision receipt path; not final production OCR/gateway or real social sign-in |
| Native Android | API 36 ARM64 debug build installed on Pixel 7 AVD; development client resumed with Fabric and no observed fatal runtime log; user supplied Talk layout feedback | UI automation cannot bind the emulator window; compact-control visual/interaction acceptance and physical-device audio remain pending |

Current continuation evidence: `cargo fmt --check`, strict Clippy/build and all
106 ordinary API tests passed; 165 mobile tests, TypeScript/lint, all 21 Expo Doctor
checks and iOS/Android exports passed. All platform-api packages passed vet/build
and race tests; the AI ledger package was rerun against isolated real Postgres for
captured speech replay. The five GitOps modules passed 16 tests, Helm lint and the
new speech backend/routes/policies passed installed-CRD server dry-run. The eight
release configuration tests passed. Tests initially exposed missing native-audio
Jest setup and stale Nearby state; native test setup and request-key-based display
were fixed. A JEV retake fixture initially supplied probabilities inconsistent
with its selected choice; the fixture was corrected while retaining rejection
and retake assertions.

The compact Hands-free dock was visually checked on iOS. Starting it exposed
Stop and the active indicator; stopping restored Type, manual recording and
Hands-free start controls. Existing conversation content was preserved. Icon and
dock regression tests reproduced the original failures before the fixes. The
final mobile lint run has no findings.

A fresh synthetic `ଧନ୍ୟବାଦ` API request returned 562,586-byte mono 24 kHz WAV
(11.56 seconds including padding); retranscribing it detected Odia with 0.9
confidence and exactly `ଧନ୍ୟବାଦ`. This verifies generated content, not a language
quality benchmark. A live four-turn sequence also verified Odia → English,
Hindi reply → Odia, French partner → Hindi and Hindi reply → French. The first
probe exposed a rewritten Hindi transcript and an English result for a Hindi
target; schema/current-turn instructions were tightened and the typed-transcript
invariant now forces review on a rewrite. The regression and repeat live sequence
passed. This remains example-based evidence, not an accuracy guarantee.
Simulator acceptance used local debug auth/direct Vertex,
without a configured live JEV judge. Production JEV, speech and generation gateway
activation still require signed-customer acceptance. Nearby reused the existing
namespace-scoped Places credential only in a local process; it was not printed,
written to disk or changed in the live cluster. That temporary process is stopped
after QA. The simulator was granted location only for the synthetic test position.
No live deployment or permission policy was changed.
The restarted local debug API has no Places credential; Nearby returns an
unavailable response until a development credential is supplied again.

Native simulator: **Roamie QA – iPhone 17, iOS 26.5**,
`B75CF754-A59A-4891-8C30-58ADA9A11888`. Existing Kora simulator state was preserved.
The current iOS bundle was exercised through the installed development build.
Generated native build passed with zero errors and one warning. Metro uses the
IPv4 DNS option documented in [mobile builds](mobile-builds.md).
Android target: **roamie_qa_api36 – Pixel 7, API 36, ARM64**, `emulator-5554`.
The native debug build passed using Java 17 and was installed/launched through
ADB. Generated native files are ignored and were not manually edited.

The signed-customer API receipt test exercises OCR → gateway/JEV →
gateway/generation with card redaction and authoritative amount checks. Photo-size,
partial OCR, malformed/unavailable judge, retake, repeated upload and unsupported
amount cases are covered. These are integration/failure tests, not an accuracy or
language calibration benchmark. The large-photo fixture was corrected to consume
upload bytes before acknowledging storage; no failing tests were skipped/deleted.

## Release gates

1. **Supply chain:** API Trivy reported 1 critical and 225 high OS findings; lean
   MCP reported 58 high and no critical. Stable fixes were not reported for the
   remaining OS advisories. The API critical libxml2 finding is CVE-2026-6653;
   Debian's tracker classifies it minor/no-DSA with an unstable-branch fix. Assess
   reachability and select a supported remediation or explicitly reviewed risk;
   do not blanket-suppress it. Four MCP Python findings came from build-tool
   components in cryptography's wheel SBOM, absent from the installed runtime.
   Retain the SBOM and record that distinction. Mobile npm audit retains upstream
   high/moderate advisories after safe fixes. Rust audit has zero vulnerabilities
   and retains unmaintained/yanked warnings. This review is not a clean security
   attestation.
2. **OpenBao and gateway:** no scoped `BAO_TOKEN` was available. Copy a pinned Kora
   TypeSafe key version with the prepared create-only helper; reconcile the exact
   gateway reader and Workload Identity binding, then runtime and Registry routes.
   No live credential copy, policy/IAM change or production rollout has run.
3. **Accounts and TestFlight:** reviewer identity `roamie-review@tesserix.app`
   was created and its password verified against the identity provider. Native
   iOS reviewer email login, session restoration after restart and live Bonjour
   to Hello translation passed on an isolated simulator. Android reviewer login
   and real Google/Apple sign-in remain unverified. The hosted email sign-in
   button is included in the signed build 3, absent from build 2. Apple
   bundle registration, Roamie's
   provisioning profile, team distribution certificate and EAS submission key are
   configured. Candidate **0.1.0 (2)** completed successfully in EAS at 01:22 UTC:
   [build](https://expo.dev/accounts/tesserix-org/projects/roamie/builds/78e113b7-d662-4b3c-9940-a8fb4bda88d2).
   The downloaded IPA passed strict code-signature verification; bundle/version,
   team, App Store profile, disabled debugging and microphone copy were checked.
   App Store Connect app **6821785215**, EAS submission configuration and
   `ROAMIE_ASC_APP_ID` are set. Submission succeeded and Apple processing is
   `VALID`; the build is ready for internal testing. Samyak and Mahesh are
   assigned in Roamie Internal with builds 2 and 3; Samyak is `INVITED` and
   Mahesh is `INSTALLED`. The three external tester addresses are `NOT_INVITED`
   in Roamie External with build 3 assigned. Build **0.1.0 (3)** completed in EAS,
   uploaded successfully and was processed by Apple as `VALID`. External beta
   review for Apple build `34053ade-e366-408e-95c8-8cd313e2e512` was submitted
   and is `WAITING_FOR_REVIEW`; the external build is `WAITING_FOR_BETA_REVIEW`.
   Automatic notifications are enabled for build 3. The matching Mark8ly **Internal Testing**
   group was also reproduced with automatic build distribution: Samyak, Mahesh
   and `rjpari03@gmail.com`, with builds 2 and 3 available. The third tester's
   existing Sales-role account received Roamie app visibility while preserving
   its role and existing allowed apps; Apple reports that tester `INVITED`.
   Complete contact fields and the demo credentials are saved in protected Apple
   review metadata. Beta
   description, feedback email and the company privacy URL are configured.
   The updated IPA passed strict signing and export-declaration checks. Saved
   browser permission still blocks
   App Store Connect; status and tester setup used the authorized Apple API.
4. **Devices and connected journeys:** iOS and Android development builds are
   installed on simulators. Complete Android visual/interaction acceptance,
   physical permissions,
   audio, notifications, OCR receipts/statement PDFs/signs, nearby/geolocation/FX,
   trip planning and manager/specialist behavior after gateway activation. Match
   each signed-account model call to a console event and user/service identity.
5. **Product governance:** implement per-user abuse/cost controls and decide
   privacy, document/account deletion and retention rules. Verify sourced/dated
   SOS data and provider privacy admission. Broader financial capture durability,
   accessibility/font-scale and language/document-quality calibration remain gates.

## Activation order

Follow the isolated GitOps [handoff](../../roamie-gitops-integration/docs/roamie-jev-handoff.md):
copy the pinned key, reconcile its reader, approve the gateway IAM binding and
manual-sync runtime, import twelve resources through the existing Registry seed,
then publish and pin the API image. Keep the previous API digest and Registry
revision for rollback. No new Roamie database migration is needed. Check the
console's deployed ledger schema independently; do not run pending platform
migrations without a separately named approval.

Use a designated signed customer on the emulator and real devices for the complete
upload/AI/console matrix before authorizing wider access. TestFlight follows
[mobile build setup](mobile-builds.md); draft product releases follow
[release lifecycle](releases.md). Specific approval is required before production
IAM/policy changes, rollout, migration or rollback under the working agreements.

Local evidence logs are `/tmp/roamie-*.log`; synthetic live receipt output is
`/tmp/roamie-live-receipt-result.json`. Synthetic gateway exports and diagnostics
are in `/tmp/roamie-gateway-probe/`. Secret-bearing temporary API/port-forward
processes from the live probe were stopped. Its synthetic OCR job remains subject
to existing service retention; no live resource deletion was performed.

## Commands run

- API: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`,
  `cargo test --locked`, `cargo build --locked`,
  `cargo llvm-cov --workspace --fail-under-lines 70`, `cargo audit --json`,
  isolated `cargo test --locked -- --ignored` and the real-MP4 media check.
- Mobile: `npm test -- --runInBand`, `npx tsc --noEmit`, `npm run lint`,
  `npx expo-doctor@1.20.4`, `npx expo export --platform all`, native iOS build,
  simulator install/launch and the journeys listed above; Android
  `./gradlew app:assembleDebug -PreactNativeArchitectures=arm64-v8a
  -PreactNativeDevServerPort=8097 --max-workers=2 --info
  -Djava.net.preferIPv4Stack=true -Dorg.gradle.internal.http.socketTimeout=30000
  -Dorg.gradle.internal.http.connectionTimeout=15000`, ADB install/launch,
  activity and runtime-log checks.
- Delivery: both Docker builds and smoke scripts,
  `node --test scripts/ci/*.test.mjs`, `actionlint` and redacted Gitleaks over
  changed files (no leaks found).
- GitOps: `uv run --with pytest --with pyyaml python -m pytest` for the five
  named gateway/copy/reader/ownership modules, four-chart `helm lint`, generated
  Registry parity, `kubectl apply --dry-run=server` for the candidate manifests,
  `terraform fmt -check`, backend-free init, `terraform validate`, `terraform test`.
- Console: package dependency builds; console-core tests/typecheck/lint;
  `pnpm --filter console exec vitest run --maxWorkers=2`, console typecheck/lint/
  production build; `go test -race ./internal/modules/aiusage/...` with isolated
  Postgres, module `go vet`, `go build ./...` and `gofmt` checks.

The first console-core run failed because its built dist artifact was missing;
workspace dependencies were built and the complete suite then passed. The first
isolated ledger container exited before readiness; a new disposable container
completed the full package tests. These failures were investigated without
weakening assertions. All database test containers were cleaned up.
