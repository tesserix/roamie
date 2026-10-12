# Independent language recognition for translation

The October 12 beta reproduced English input identified as Hindi when Hindi was
also the requested target. Conversation combined recognition, two translations,
and recent turns in one prompt. The resulting source label controlled routing,
so a target/source mix-up could return the original input or address the wrong
participant. An initial new traveller language also required an expected-speaker
hint that the first turn never supplied.

Recognize the current utterance without target languages or prior turns, then
translate with that source fixed. Audio is sent only to recognition; translation
uses its transcript. Typed input remains authoritative. Conversation context is
limited to the last six turns and used only for translation and JEV fidelity
review. Explicit source settings remain fixed. In AUTO, a first language distinct
from the known partner initializes the traveller; subsequently known language
matches take precedence over expected turn order. A new language follows the
expected participant, with JEV reviewing uncertainty before playback.

This adds one small model call per automatic text translation and conversation
turn; explicit text remains one call. No new service, storage, or API version is
needed. Existing 60-second route cancellation bounds the two 45-second provider
calls and 1.5-second JEV review together. No peak traffic or latency SLO is supplied;
record actual synthetic latency before rollout and do not claim a latency SLO.
Provider outages return an error; there is no direct-provider production fallback.
Conversation JEV review remains required in release builds.

A stronger combined prompt alone was rejected because source and target still
share model context. Speaker identity cannot be established by language alone:
same-language speakers and interruptions that change language can be ambiguous.
We retain review instead of claiming voice identification.

Deploy the API only after the existing gateway/JEV prerequisites are available.
No data migration or mobile API change is required. Rollback uses the previous
API image, but also restores its prior gateway configuration. Test fixtures cover
source/target confusion, Hindi/Odia direction, first-turn AUTO, language changes,
and explicit traveller-language preservation.

## Verification — 2026-10-12

Worktree: `../roamie-auto-conversation`, branch `fix/automatic-conversation`,
based on release commit `174ca074f523f535538256ec68b15d66e9b1d7c0`.
Unrelated worktrees were preserved. Changes are not committed or published.

- Reproduced failing source/target confusion and initial Hindi AUTO regressions
  before implementing the fixes.
- `cargo test`: 114 passed, 7 pre-existing database tests ignored because they
  require a disposable PostgreSQL database. No database code changed.
- `cargo clippy --all-targets -- -D warnings`: passed.
- `cargo fmt --check` and `git diff --check`: passed.
- `cargo build`: debug binary used for local real-model verification.
- A local debug server using Vertex Gemini 2.5 Flash correctly detected English,
  Hindi, and Odia text. Hindi → Odia and Odia → Hindi preserved train-station
  meaning. Switching the traveller to English kept the partner's Odia language.
  Sample conversation response times were 2.52–4.11 seconds, not a benchmark.
- Synthetic Hindi audio generated with macOS Lekha was detected as Hindi and
  transcribed correctly, with an Odia translation and female voice selection.
  No live Odia audio, device microphone, or target-language playback was tested.
- A gateway contract test verifies both recognition and translation retain the
  caller's authorization and that JEV receives source/target/translation evidence.
  The real-model checks used development Vertex transport without JEV; they do
  not establish deployed gateway or JEV success.

## Deployment status and prerequisites

TestFlight 0.1.1 build 6 does not deploy the API. The current production API image
is still `v19b6209`, digest
`sha256:a770f699a388fa711cb988e5056a5dc1beb6328a2e106a4c1319e97651e4abec`.
Its `TurnRequest` has neither `autoMine` nor `expectedSpeaker`. This is an omitted
backend rollout, not evidence that the mobile fix was reverted.

The required `roamie-ai` service is absent from `agentgateway-system`, and the
`agentgateway-llm` Workload Identity policy lacks the Roamie gateway binding.
An authorized Kubernetes login using the existing Roamie OpenBao reader returned
403 for `kv/data/roamie/app/roamie-typesafe-api-key`; the short-lived OpenBao login
was revoked. This does not establish whether the secret exists. No operator token
was available in the environment or standard local token cache. No credential
values were printed, changed, or copied.

The existing gateway preparation lives in `../roamie-gitops-integration` and was
not modified. An authorized OpenBao operator must provision/verify the Roamie JEV
credential and its reader policy. Complete the gateway's GitOps chart, cloud
identity binding and production checks before updating the API image; the current
release build deliberately requires gateway transport and conversation JEV review.
Then validate with the reviewer account and TestFlight app, including actual
Hindi/Odia audio and playback. No production rollout was performed in this change.
