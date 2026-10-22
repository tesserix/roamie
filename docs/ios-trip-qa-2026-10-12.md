# iOS trip and translation QA — 12 October 2026

Target: the existing Roamie QA iPhone 17 simulator, iOS 26.5. Signed in with
the dedicated store-review account. Credentials are retained outside the repo.
Android acceptance follows iOS; it is not certified by these results.

## Translation fix

“Show them” now uses the translation, target language and pronunciation attached
to the selected turn. It previously used the other person's bubble text, which
was the original transcript for an incoming message. Read-aloud uses the same
stored translation and target, including when the conversation changes language.

Verified against the authenticated public API:

- Hindi `क्या आप मुझे स्टेशन का रास्ता बता सकते हैं?` → English
  `Can you tell me the way to the station?`; Show them displayed English.
- English reply `Yes, please show me the nearest station.` → Hindi
  `हाँ, कृपया मुझे सबसे नज़दीकी स्टेशन दिखाएँ।`; Show them displayed Hindi
  and its pronunciation. The partner's Hindi language was remembered.

UI regression tests cover both directions, target-language accessibility metadata
and pronunciation. The previously incorrect incoming-turn expectation was corrected.
Screenshots: `/tmp/roamie-show-them-hi-en.png`, `/tmp/roamie-show-them-en-hi.png`.

## Trip creation

Synthetic saved trip: **QA Japan family trip**, Tokyo 20–22 October 2026,
Kyoto 23–24 October, two adults and one child, two bags, AUD 2,500 whole-party
ceiling, Relaxed/Culture/Family, vegetarian, Gardens/Museums.

Passed on the simulator:

- Authenticated Google destination search and selection for Tokyo and Kyoto.
- Disabled past departure dates; destination duration/date alignment.
- Reordering destinations recalculated day ranges; restoring the order restored dates.
- Party, luggage, styles, interests, diet and budget saved and restored after reload.
- Rejected 16 days when the maximum is 14; rejected a party without an adult.
- The saved manager profile now displays one `vegetarian` requirement.

Destination search initially failed because cached development JavaScript referenced
a stopped local API. Reconnecting Metro with the authenticated public API restored
search. No production destination-service change was required.

## Generation findings

The public `/v1/trip-manager` request returned HTTP 504. Preference GET/PUT and
destination lookups returned HTTP 200. The original ingress had a 70-second overall
and 65-second per-try timeout; the API manager client allows 85 seconds and the
manager's outer deadline is 80 seconds. Approved infrastructure PR
[tesserix-k8s #1361](https://github.com/tesserix/tesserix-k8s/pull/1361) merged as
`5ffc91617ed5adbcc48e0d0910d57e17ed4b4235`. Argo CD `roamie-istio` is Healthy
and Synced to that revision. Live `/v1/trip-manager` now has a 95-second deadline
and zero retries. Five PR checks passed before merge.

Live worker diagnostics also reported `model_failed`, state `budget_exhausted`,
with manager `WorkerCallError`. These logs do not identify the exhausted dimension;
raising a limit without that evidence would not establish a reliable fix.
Generation succeeded through a localhost-only diagnostic tunnel to the same
authenticated API. Budget/balanced/premium options appeared, and selecting the
balanced option populated all five Tokyo/Kyoto dates. The tunnel is now stopped
and Metro restored to the public authenticated HTTPS API. The public retest
after the ingress rollout still failed with a manager availability message.
Worker generation completed; manager logs reported `deadline_exceeded` and
`manager_review_unavailable` caused by `TimeoutError`. This is not resolved by
the ingress change alone.

A non-JSON gateway timeout now produces a specific retry message without signing
out or losing the saved trip. The temporary HTTP diagnostic log was removed.

## Verification and release

- `npm test -- --silent`: 187 tests, 40 suites passed in the latest run.
- `npx tsc --noEmit`: passed after correcting the new response test double.
- `npm run lint`: passed.
- `npx expo-doctor`: 21/21 checks passed.
- `node --test scripts/ci/mobile-release.test.mjs scripts/ci/testflight.test.mjs scripts/ci/release.test.mjs`: seven checks passed.
- Infrastructure regression: generation deadline, ingress auth and mesh connectivity,
  three tests passed with `uv run --with pytest --with pyyaml python -m pytest`.

The first regression runs reproduced dietary duplicates, incoming Show them using
the transcript, and the generic gateway timeout message before their fixes.

TestFlight production build **0.1.0 (4)**:
[`bdbe9176-ad91-4325-b670-f75ed6fd2716`](https://expo.dev/accounts/tesserix-org/projects/roamie/builds/bdbe9176-ad91-4325-b670-f75ed6fd2716).
Build uses authenticated `https://roamie-api.tesserix.app`, never the diagnostic
tunnel. Apple processing is VALID and internal state is IN_BETA_TESTING. External
state remains READY_FOR_BETA_SUBMISSION: Apple refused another submission while
build 3 is WAITING_FOR_BETA_REVIEW. No review was withdrawn. Build 4 contains the
translation/diet/initial timeout fixes; it does not contain the later PDF, day-card,
endpoint-specific timeout wording or multi-city readiness deadline changes.


## Saved itinerary and export

The selected plan and manual QA edits survived terminating and relaunching the app.
Day 1 Godzilla Head was changed to 60 minutes with a synthetic AUD 12.50 cost.
Day 4 received a synthetic vegetarian lunch costing AUD 45. These are QA inputs,
not researched prices. Unknown costs remain visibly unverified. The Kyoto share
card now uses the selected day's destination.

The native six-page itinerary PDF was rendered and every page inspected, including
a 2000-pixel rerender of page 3. The final headings and content are legible; the
earlier suggestion that final pages 3/6 were clipped was not supported by this
inspection. Native margins and day page breaks are retained. Artifact:
`/tmp/roamie-japan-qa-itinerary-final.pdf`. Native preview and share sheet opened;
sharing was dismissed without transmitting the file. Longer content and Android
print rendering still need acceptance testing.

## Further candidates, not deployed

The mobile weather/entry check reused a single 120-second timer across sequential
cities. A fake-clock regression reproduced failure when each city needed 70
seconds. Resetting the deadline for each city passes; cancellation remains shared.
A translation 504 no longer mentions a saved trip. Both have regression tests.

The manager candidate bounds each supporting weather/entry review to 25 seconds
and returns an explicit unavailable advisory on availability/deadline failures.
Profile changes and invalid signatures still fail closed, and the itinerary's
final review is mandatory. The first real-gateway candidate run reached that
review in 64.63 seconds, but was rejected; it is not a successful acceptance test.
The subsequent candidate run returned three options in 54.85 seconds, with
request review `38e0799f4a2641c09d803f6098119403` and final approval
`d61b1df1209b41f797b5da0eb47746b1`. Weather remained explicitly unavailable;
entry guidance required missing passport/residence details. This was an isolated
QA process using the deployed gateway/providers, not a native public-service
acceptance test.

Approved manager release PR: [ai-agents #83](https://github.com/tesserix/ai-agents/pull/83).
Production-compatible release commit: `ef52d08b7c42a791e3ed172fcce4f5bc05c554ec`.
The old manager file matches the deployed service's SHA-256 before the patch;
the maintenance branch avoids mixing newer main-branch contracts with old workers.
394 tests pass with 90.79% coverage, strict mypy, Ruff and package build. The
fix is also forwarded to current main. GitHub refused CI/publishing jobs before
start because of failed account payments or spending limits (run `38213920022`).
The PR remains unmerged, no image was published, and no manager production
rollout has occurred. User approval for this rollout is already recorded; billing
recovery and passing CI remain necessary.

Android AVD `roamie_qa_api36` booted and is listed by adb, but the computer-use
tool does not expose its qemu window. Native Android interaction remains untested.

## Public readiness retest after the mobile deadline fix

The native iOS Tokyo/Kyoto check completed without losing all results. Tokyo
weather was unavailable, while both cities displayed entry checklists with
unverified eligibility/fees warnings. Kyoto retained the provider coverage
warning for two dates outside the forecast window. This establishes partial-result
handling and missing-date messaging; it does not establish Tokyo weather success
or visa eligibility. The control returned to “Refresh trip checks”.

The current mobile package also exported successfully for iOS, Android and web
with `npx expo export --platform all --output-dir /tmp/roamie-mobile-current-export`.
The main-branch manager forward-port passed 433 tests with 91.20% coverage, mypy
and Ruff locally after integration with existing main changes. Neither local
validation nor the native readiness retest replaces the blocked CI/release gate.


A further regression showed that destination lookup failure blocked planning despite
valid coordinates already saved by the destination selector. Planning and readiness
now share a resolver that reuses valid saved latitude/longitude and searches only
for older or invalid records. Out-of-range and NaN coordinates fall back to the
provider; missing fallback coordinates still require a new selection. Red/green
regressions cover provider failure and invalid stored coordinates.

## Weather provider root cause and local follow-up

A direct request from the manager using its existing credential returned HTTP 404
with Google status `NOT_FOUND` for Tokyo. No credential values were printed.
Google's official coverage table, last updated 2026-10-08 and inspected 2026-10-12,
shows daily forecasts unsupported in Japan (also CN, CU, IR, KP, KR, SY, VN):
<https://developers.google.com/maps/documentation/weather/coverage>. This explains
Tokyo's provider failure. Kyoto's future-date response does not prove forecasts
will become available later.

A local backend follow-up returns explicit unavailable coverage evidence for those
regions, with no forecast numbers and no futile upstream request. Tests cover near
and future dates. Local main-based suite: 449 tests, 91.21% coverage; mypy and Ruff
pass. This follow-up remains uncommitted and is not part of PR #83 or the approved
maintenance image candidate. The mobile text now points to provider guidance
rather than promising a forecast later; its regression, TypeScript and lint pass.

Build 5 (`2303da1b-638d-49d3-9666-ec05b8e5becc`) was queued with automatic iOS
submission `e79803ea-0d9a-45c6-b0d0-34fceb35b95b`, using the production public API.
It includes the earlier coordinate, deadline, timeout-message, day-card and PDF
fixes, but excludes the weather wording/source follow-up added after upload.
Apple processing was read back as VALID, internal IN_BETA_TESTING, external
READY_FOR_BETA_SUBMISSION. Build 3 still awaits external beta review. Build 5
is installable internally; this is not an external-test availability confirmation.

Build 5 membership read-back confirms both existing Internal Testing and Roamie External groups contain the build. External membership does not make it installable before Apple beta review.
