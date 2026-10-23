# ADR-0023: Acoustic routing within a hands-free session

Status: Local implementation and validation; production rollout is not authorized by this ADR.

## Context

Manual language locks have been removed from automatic turns, but language and alternating-turn hints cannot distinguish a person who switches to a third language. Speaker pitch register is also insufficient. The existing API already decodes audio and runs ONNX VAD; introducing another remote inference request would increase latency and provider cost.

There are no reliable project peak-RPS or growth measurements in this work session. Capacity is therefore bounded per process rather than claimed at an invented traffic level: reuse the existing two audio-processing slots, limit speaker input to three seconds of mono 16 kHz PCM, and retain at most two 256-value references for each of two local session sides. At most 1,024 reference floats cross the authenticated request boundary; no server speaker store is introduced. The initial local target is no more than 250 ms extra warm CPU work at p95; measurements on the developer Mac are diagnostic, not production SLO evidence. The existing translation availability target is unchanged.

## Decision

Use the pinned float WeSpeaker ResNet34-LM ONNX artifact with its published 80-bin, 25/10 ms, Hamming-window, zero-dither, mean-centred filterbank. Use the existing ONNX Runtime and a pinned pure-Rust filterbank dependency. The quantized candidate failed ConvInteger execution on the development Mac and is not shipped. The weights are CC-BY-4.0 and require retained attribution.

Speaker tracking is an additive, optional hands-free audio contract. Manual text, manual Talk, image translation and offline translation do not request it. The server computes the current embedding from verified audio; the client cannot supply the current embedding. Supplied references are untrusted, bounded, finite, normalized and tied to the exact model version. They never authorize a user or identify a named person.

Within the two-speaker session, a sufficiently separated acoustic match determines which side spoke even when that person repeats a turn or changes language. Selected languages can establish references during initial turns; turn order is not allowed to override a clear acoustic match. Short clips and uncertain matches do not rewrite learned references. A third-language utterance without sufficient evidence asks for clarification instead of guessing a new target.

Real HTTP validation exposed a separate transcription problem: the existing Gemini 2.5 Flash route rewrote a synthetic Odia utterance into Hindi/Konkani even when acoustic routing chose the correct speaker. The same fixture produced Odia script with Gemini 3.8 Flash. Audio transcription therefore uses a separate `roamie-transcription` profile at `/v1/transcribe`, pinned to `gemini-3.8-flash` with the experimentally accepted `thinkingLevel: LOW`. Text and image structured requests retain their existing profile. A native provider probe rejected `MINIMAL`; it is not used. The transcription response requests original speech only; Google NMT detects the resulting text and translates it into the resolved target. This is bounded fixture evidence, not a multilingual accuracy guarantee.

The client holds only bounded embeddings in memory. Accepted, unreviewed turns may initialize a reference; subsequent acoustic matches may extend that same side's references. Stop, background, disconnect, navigation, language reselection, account exit and a new session clear them. No AsyncStorage, database, analytics, request-body log or phrasebook entry receives embeddings or retained audio.

## Failure, compatibility and cost

Embedding inference is optional for established language routing. A model error must not disable manual translation. Ambiguous new-language routing fails clearly rather than using alternating turn order. Cancellation retains the bounded CPU slot until the blocking work exits. No extra remote call or audio upload is required for speaker tracking. The float weights add about 26.5 MB to the binary; additional CPU and memory must be measured before a production capacity or cost claim. No new fixed cloud service cost is introduced. The new transcription model changes variable provider billing; no zero-cost or cost-parity claim is made. Confirm the active Vertex tariff and observed token usage before rollout. NMT, conversation review and speech playback continue to incur their existing usage charges.

Activate the four additive resources in `services/api/deploy/agentgateway-transcription.json` through the owning agentic-registry delivery workflow first, then deploy the server, verify authenticated audio plus text/image smoke checks, and only then release the mobile flow. The new route retains strict JWT/client authorization, capability and model checks, buffering, prompt guards and deadlines. Gateway-wide observability already targets its parent Gateway. Server-side Kubernetes dry-run validates the resource schema only; it does not prove live policy composition, provider mapping or billing ingestion. These require an authorized canary. Existing clients remain compatible; absent speaker results from an older server are not evidence that speaker tracking is available. Rollback is the previous application build, retaining the additive route until traffic is drained; no database migration or persisted speaker state requires reversal. A rollout needs named user approval under the repository working agreements.

The simpler language-only/turn-order alternative is rejected for the demonstrated repeated-speaker third-language case. Sending previous audio clips to the generative model is rejected because it adds audio tokens, retains more sensitive content and still needs confidence handling. A separate diarization service is unnecessary for this bounded two-speaker increment.

## Acceptance

Require real-model synthetic held-out multilingual voice tests, malformed reference and ambiguity tests, mobile session-lifetime tests, backward compatibility, complete affected suites, native builds, and local candidate HTTP/native checks. Controlled human speech, similar-voice conditions, noisy/overlapping speech and physical-device validation remain distinct acceptance work; synthetic fixtures cannot establish universal recognition or identity accuracy. Provider translation quality and offline Hindi/Odia limitations remain independent of this routing change.
