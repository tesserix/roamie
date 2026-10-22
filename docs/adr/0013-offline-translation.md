# Offline translation and downloadable speech models

## Plan and acceptance criteria

Roamie will translate supported, downloaded language pairs on the device before
using its authenticated cloud API. Text, recorded conversations, camera OCR and
read-aloud have separate readiness states. Offline translation is available from
the sign-in screen, including during authentication restoration, without opening
an account's wallet or changing server authorization.

1. Add native Android ML Kit and iOS Apple Translation bridges, local OCR,
   offline voice discovery, and streaming file-integrity verification.
2. Add a shared local-first translation path with explicit cloud/offline modes,
   cancellation, bounded cloud recovery, and no retained conversation payloads.
3. Add persistent, removable language packs and verified Whisper downloads.
   Quantized multilingual Base is the balanced default; Small is optional on
   devices with sufficient memory. Never load both speech models concurrently.
4. Connect Text, Talk and Camera and expose offline preparation before sign-in.
   Retain the current turn-taking, review and cancellation behavior online.
5. Verify routing, missing assets, interruption, account isolation and UI with
   tests, typechecking, lint, native builds and simulator/device checks.

## Decisions

Android ML Kit handles supported text pairs using roughly 30 MB per non-English
language, with English as its pivot. iOS uses Apple's Translation framework on
iOS 18+, with NaturalLanguage identification. Apple supplies and manages these
models; supported and installed pairs are checked at runtime. iOS 26 uses an
installed-model session that fails rather than downloading during translation.
iOS 18–25 sessions use the system translation task after checking installation.
Apple's confirmation UI prepares models only after a download action. Text pack
removal is managed in the system Translate settings. Earlier iOS versions retain
cloud translation and offline cards.

Apple Vision supplies iOS OCR without another bundled OCR runtime; Android
bundles ML Kit OCR for Latin, Chinese, Devanagari, Japanese and Korean scripts.
Script coverage must not be presented as translation coverage. iOS pack support
can be narrower than Android's; the UI uses each device's native capability list.

The initial iOS ML Kit integration produced an Intel simulator binary because
ML Kit excludes arm64 simulators. It was replaced with Apple's built-in engine
to reduce iOS dependencies and support current native toolchains. Translation
model downloads/inference still require a physical iPhone; simulator builds can
verify the interface and the other native components.

Whisper runs through whisper.rn. Model artifacts are pinned to a repository
revision, length and SHA-256. Downloads use app documents storage, a temporary
file and verification before promotion. Downloads require an explicit action and
use Wi-Fi by default. Whisper downloads expose progress, cancellation and retry;
they stop if Wi-Fi changes unless mobile data was allowed. Language packs use SDK
download behavior (including Apple's confirmation and system-managed policy).
No recording is uploaded when the user chooses offline mode.

The base-q5_1 artifact is 59,707,625 bytes; small-q5_1 is 190,085,487 bytes.
Quantization reduces file size, not total runtime memory to the same value.
Small is offered as an optional quality choice, not claimed faster or more
accurate for every language. Peak memory, battery use and recognition quality
remain device acceptance criteria. A short-text warm p95 under 500 ms and
end-of-speech-to-text p95 under three seconds are goals, not measured claims.
Before a cold speech-model load, the app checks process memory on iOS and system
memory pressure on Android, reserving 600 MiB for Base or 1,200 MiB for Small.
These conservative admission limits are initial safeguards, not measured peak
usage. Backgrounding, memory warnings, cancellation and 30 seconds of idleness
release speech resources; model switches release the previous model first.

ML Kit does not cover Roamie's Odia, Nepali, Sinhala, Khmer, Lao or Burmese
translation entries. Standard Whisper has no explicit Odia recognition support.
Unsupported capabilities remain visible and require the cloud; they must never
be represented as downloaded or replaced with English. IndicTrans2 is a candidate
for a separately validated Odia pack, not a model that has already been ported.
Cloud fidelity review, pronunciation guides and speaker-voice matching are not
fabricated for local results. Offline voice output requires a verified local
voice; otherwise the translation stays on screen.

Connectivity is advisory. Ready local models do not wait for a network probe.
When speech recognition succeeds locally but a text pack is missing, automatic
mode sends recognized text to the cloud instead of re-uploading the audio.
Unavailable local capability can use the existing cloud API only when allowed;
offline mode cannot. Translation models are installation-wide, while existing
account stores and cloud credentials retain their current boundaries. Raw audio,
images and transcripts are not persisted in a translation cache or telemetry.

## Rollout and validation

The native module and whisper.rn require a new binary and a new runtime version;
an OTA-only update cannot add these capabilities. Existing binaries continue to
use the cloud path when the optional native bridge is unavailable.

Acceptance includes a cold airplane-mode launch, expired authentication, missing
or corrupt models, interrupted downloads, denied cellular downloads, language
changes during inference, cancellation/backgrounding, unsupported scripts, and
text-only operation when no offline voice is installed. Physical-device quality,
peak-memory and battery measurements are release gates, especially for Small.

## Sources

- https://developers.google.com/ml-kit/language/translation
- https://developers.google.com/ml-kit/language/translation/translation-language-support
- https://developers.google.com/ml-kit/vision/text-recognition/v2
- https://github.com/ggml-org/whisper.cpp
- https://github.com/mybigday/whisper.rn
- https://huggingface.co/ggerganov/whisper.cpp/tree/5359861c739e955e79d9a303bcbc70fb988958b1
- https://github.com/AI4Bharat/IndicTrans2

## Implementation and validation notes — 2026-10-22

The shared provider path, native bridges, preparation UI, guest tools, model
verification, memory admission and Text/Talk/Camera integration are implemented.
The main translator offers Automatic, Offline only and Cloud preferences. Guest
tools always force offline operation. Restoring these preferences precedes
opening account features, including on binaries without the optional native
module. Changing modes cancels active translation work. Cloud translation paths
also recheck offline mode immediately before sending a request or retry.

Local photos and recordings stay as file URIs. Base64 is created only for a cloud
fallback that actually needs the original media. Successful local recognition
uses a much smaller text request when cloud text translation is necessary.

Native build checks include Android `:app:assembleDebug` for arm64, an arm64 iOS
simulator build, and an unsigned arm64 iPhone device build. Expo production
exports for iOS and Android are verified separately from the native Debug builds.
The `buffer` dependency supplies whisper.rn's required Buffer implementation;
the Jest-only Babel dynamic-import transform exercises the lazy provider paths.

SDK 57 patch dependencies were aligned with Expo Doctor's compatibility map.
The native bridge imports its public JS API from `expo`; `expo-modules-core`
remains Expo's transitive dependency. Doctor passes all 21 checks. The wider
production dependency tree still reports 53 audit findings (45 high, 8 moderate,
no critical); none are attributed directly to buffer, whisper.rn or expo-network
in the audit output. These findings require a separate dependency remediation
before treating the application as release-ready.

In the dedicated `Roamie Offline QA` simulator, guest tools opened without an
account; Base plus the speech detector downloaded and passed size/SHA-256 checks,
survived an app reinstall, and remained intact after a cancelled Small download.
The models occupied 59,707,625 + 885,098 bytes. No partial Small artifact remained.

A temporary, subsequently removed native test harness used a 2.54-second
synthetic AAC recording: “Hello. Where is the nearest train station?” It exercised
the real AAC→PCM conversion, checksum verification, Silero VAD and quantized Base
inference, returning “Hello, where is the nearest train station?” and `en`.
The first development cold run took 25.425 seconds; subsequent runs took 4.215
and 3.945 seconds. These CPU-only simulator development measurements include
loading and inference and are not phone benchmarks. The three-second goal is
not yet verified. A physical-device quality/latency/battery matrix remains a
release gate; Small must be included in that matrix before recommending it over
Base for a specific phone or language.

To try the feature, install a new native build, open **Offline translation** from
sign-in or **Offline languages** from the main translator, choose the two
languages, and download their supported packs over Wi-Fi. Download Base first;
Small is an optional memory-gated alternative. On iOS, accept Apple's language
download prompt and refresh readiness. Then use the offline Text, Talk or Camera
tools. A physical iPhone with iOS 18+ is required for Apple text inference.

The final mobile suite contains 297 passing tests across 54 suites. Readiness
stays in a checking state until native asset discovery finishes, avoiding false
missing-pack messages and duplicate downloads while checks are pending.
Typechecking, lint and `git diff --check` pass. Commands run from `apps/mobile`
with Node 22 include:

```sh
npm test -- --silent --json --outputFile=/tmp/roamie-offline-all-tests.json
npx tsc --noEmit
npm run lint
npx expo-doctor
npx expo export --platform all --output-dir /tmp/roamie-offline-export
```

Android arm64 standalone Release and iOS arm64 simulator standalone Release
builds are also produced. The simulator app opens with Metro stopped and retains
its installed Base model. The local Android APK uses the scaffold's test signing;
it is a testing artifact, not a store submission. Android runtime checks could
not be performed here because no device or emulator is available. Simulator UI
checks and native compilation do not replace physical iOS and Android testing
of translation quality, airplane-mode operation, memory, latency and battery.
