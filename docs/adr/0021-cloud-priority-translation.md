# 0021: Cloud priority for interactive translation

Status: accepted, 2026-10-23. Supersedes the local-first routing policy in ADR 0013.

## Context

A downloaded model is not evidence of fast inference. Customers reported 40–50 second conversational delays after offline support was introduced. Authenticated production audio probes completed in 3.47–4.58 seconds, while capture and speech playback contained additional waiting points. Simulator results do not establish performance on an iPhone X.

## Decision

Automatic starts cloud Text, Talk and Camera requests before inspecting models. Connectivity discovery is bounded to 100 ms. After two seconds, a compatible, verified downloaded engine may try a local fallback while cloud continues. A retryable cloud failure starts that fallback immediately. The first successful result wins and cancels the other attempt. A missing, incompatible, stalled or failed local engine cannot cancel a working cloud request. Authentication, permission, input and no-speech errors remain authoritative.

Fallback readiness is bounded to 300 ms. Once ready, connected inference retains the existing 2.5-second text and four-second Talk/Camera limits. Explicit Offline only and a disconnected device use local inference without those online limits and never send a translation request. Switching to Offline only or stopping cancels in-flight work and suppresses retries and late results. Existing model checksum, download and device eligibility checks remain in force.

Connected read-aloud uses the platform voice without a second offline inventory query. Offline read-aloud still requires an installed offline voice. Voice enumeration and offline inventory checks have 500 ms limits. A native voice that does not start within two seconds can fall back to generated audio. Speech preparation is bounded to eight seconds; actual playback has a separate duration allowance. Previous native stop calls complete before new native speech is queued, and obsolete callbacks cannot finish newer generated playback.

Hands-free detects a sustained relative level drop as well as the existing absolute silence threshold, with 800 ms endpointing and protection against brief loud transients. Its screen wake lock lasts through capture, translation and playback and is released on stop, backgrounding or failure.

## Cost and validation

Automatic deliberately prioritises response time over model utilisation. Presence of a downloaded model alone must not restore local-first behaviour. A future fast local path needs device-specific measured latency, verified assets, warm-runtime availability and memory/thermal checks. Do not add conversation storage or training uploads as a cost optimisation without the separate consent policy.

Regression coverage includes cloud/local races and cancellation, offline privacy, missing models, voice stalls, native stop ordering, noisy pauses and screen wake lifecycle. QA uses a signed-in simulator, actual microphone capture and the production API. A temporary local proxy records timing metadata only. Physical iPhone X acceptance remains required before claiming its reported delay is resolved.
