# ADR 0026: Local denoising and speech-aware capture

Status: implemented locally; device validation and release gates remain open.

## Problem and measurements

Hands-free capture used a fixed -42 dB loudness threshold. Live simulator runs
repeatedly reached the 30-second recording cap before sending a turn. API calls
then took another 3.9–7.7 seconds. Durations include leading wait and speech;
they are not all post-speech latency. Durable retries cannot repair endpointing.

A native WebRTC detector reduced several endpoints to 0.8–0.9 seconds of detected
silence, but intermittent noise caused false turns and missed the opening of two
Vietnamese fixtures while the app was processing a false turn. A correctly timed
Vietnamese run preserved the full utterance but still waited 3.31 seconds after
playback ended before upload. Hindi's full long utterance uploaded after 0.64 seconds.

Platform voice processing was evaluated and rejected for this implementation:
a controlled short English simulator test still hit the 30-second cap. SpeexDSP
suppression reduced the recorded failure samples by only about 1 dB.

## Decision

Capture mono 48 kHz audio locally, process 10 ms frames through bundled RNNoise,
and combine its speech probability with WebRTC VAD on the original frame. The
second detector rejects stationary noise that RNNoise alone sometimes labels as
speech; applying it only to the cleaned signal allowed filtering artifacts to
trigger speech. Require both detectors, then aggregate every 100 ms for the JS
turn controller. Keep its 300 ms speech onset and 800 ms silence endpoint.

Downsample cleaned audio to 16 kHz using a 63-tap, 7.2 kHz low-pass FIR before
upload. Flush the denoiser/filter tail on stop. The 30-second file remains about
960 KB rather than tripling uploads to 48 kHz. Raw audio is not sent over the JS
bridge. Capture is bounded, stops on background/interruption, and recordings use
private temporary storage. Release logs must contain no speech, audio or tokens.

The native module uses AVAudioEngine on iOS and AudioRecord on Android. Existing
app binaries without this native capability retain their Expo recorder; a native
store build is required to receive the improvement. New recognition, language
routing, translation and voice-provider contracts are not introduced here.

RNNoise v0.1 and libfvad are pinned with source provenance and BSD licenses under
`apps/mobile/modules/roamie-capture/ios/common`. The bundled denoising weights are
not a translation model and do not enable offline hands-free mode. No runtime
model download, subscription, network request or new service is required.

## Budget and validation

Target: reliable capture handoff within 1.2 seconds after a clear phrase ends in
a quiet room, with no sustained-noise false turns. Translation/review/playback
remain separate latency stages; this ADR does not claim Google Translate parity.
The denoiser has approximately 10 ms algorithmic delay plus less than 1 ms FIR
delay. Preliminary Mac fixture processing consumed roughly 0.15–0.21 seconds for
12–13 seconds of speech; these figures are not physical-phone battery benchmarks.
Recorded noise attenuation in the standalone prototype was about 17–23 dB.

The native C test compiles the actual shared implementation and exercises silence,
stationary noise, clicks, soft speech and speech with continuous noise. It requires
at least 6 dB attenuation on seeded white noise, no 300 ms false speech run, and
preserved speech detection. Full app tests must verify complete transcripts,
correct direction, spoken playback, cancellation, background handling and repeated
turns. Playback-completion duration must not be reported as time-to-first-audio.

Benchmark evidence lives in the local QA output directory. Initial integration
failures are retained alongside successes. Builds alone and synthetic checks do
not certify physical-device performance or all-language accuracy.

## Limits and release gate

Noise suppression cannot promise removal of nearby speech or TV dialogue, nor
speaker identity isolation. It may change very quiet speech; soft-speech checks
and real microphone tests are required. Do not add a synchronous API cleanup call
without measured recognition benefit and an explicit latency/cost budget.

Hold the new release until the native builds pass repeated end-to-end tests. The
API still has approximately 4–6 seconds of latency on measured turns and requires
separate stage-level diagnosis. Physical iPhone testing is unavailable until a
device is connected; Android native compilation is not Android UI validation.
