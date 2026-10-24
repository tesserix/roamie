# Offline translation validation

Review date: 24 October 2026. Status: automated checks and local native builds passed; **not cleared for production release**.

## Scope and behavior

Profile → Offline languages manages ML Kit text models on the phone. The same translator is available from sign-in so a network-dependent session refresh cannot prevent local text translation. Select explicit source and target languages and download both before travelling. Readiness comes from the SDK inventory, not a saved UI flag. Filipino maps to `tl`. Khmer, Lao, Burmese, Nepali, Odia and Sinhala are not supported by this offline engine (30 of 36 app languages supported).

Online translation retains its existing provider. When native connectivity reports offline, text and explicit-language Talk requests use the installed models before authentication or HTTP requests. Network failures recheck native connectivity before local fallback. On iOS a satisfied network path does not guarantee internet access: captive portals and unreachable internet remain a release test case. Camera and hands-free translation remain online-only.

Text models, speech recognition and spoken output have separate readiness. Recognition explicitly requires on-device processing; iOS checks each locale's native capability. Unsupported or unavailable speech must leave typing usable. Speech inventory queries time out after five seconds per provider. This bounds UI waiting but does not cancel an unresponsive native service. Closing the screen or backgrounding cancels recognition/playback; late permission responses must not start the microphone.

Only one translation/model mutation runs at once. One translator pair is cached. Downloads may outlive the screen; reopening queries native inventory. Removal invalidates pairs using that language. No transcript is persisted by the offline manager; only the selected pair is stored.

## Verified evidence

Raw artifacts are under `output/offline-translation-review/` (local QA artifacts, not release assets).

- Full mobile suite: 64 suites, 1,630 tests passed (`final-jest.log`).
- `npx tsc --noEmit`, `npm run lint`: passed after the speech timeout fix.
- `npx expo-doctor`: 21/21 checks passed.
- Speech timeout regression: two tests failed with `Received: undefined` before the fix, then all five speech tests passed (`speech-timeout-red.log`, `speech-timeout-green.log`).
- Android QA APK: actual Expo native bridge and app API routing, embedded JS, no Metro dependency. Dedicated API 36 ARM64 emulator `roamie_offline_qa`, serial `emulator-5558`; separate application ID `app.tesserix.roamie.offlineqa`.
- Airplane mode with Wi-Fi/data disabled and force-stop/relaunch: French, Hindi, Japanese, Thai and Spanish all translated locally (30 samples). Every result asserted `offline: true` and native status offline.
- Missing French/German blocked; deleting French invalidated readiness and blocked translation. Force-stop during Spanish download did not produce false readiness; reconnect/retry completed and subsequently translated offline.
- Test runner restored airplane mode off, Wi-Fi/data enabled. `integrated-android-results.json` and `integrated-android-run.log` hold assertions/results.
- Normal Android release build with R8 minification and resource shrinking passed (`final-android-minified-build.log`). Installed and launched on the isolated emulator. Through the signed-out UI: opened Offline translator, downloaded English/French, verified readiness, force-stopped, enabled airplane mode with Wi-Fi/data off, reopened and translated “Where is the station?” → “Où est la gare?”. UI hierarchy assertions and `normal-airplane-translation.png` capture the result. Connectivity restored and ADB root disabled afterward. This does not cover authenticated Profile navigation or iOS UI.
- Unsigned ARM64 iPhone Debug build passed (`native-ios-device-build.log`), including the offline translation and speech native modules. This is compilation/link validation, not a signed Release archive or physical-device runtime test.
- iOS generic simulator build passed. This is an x86_64 simulator build: ML Kit excludes ARM64 simulator support. Compilation is not runtime validation on iPhone.

## Performance smoke measurements

These measurements are from a host emulator with concurrent build work, not a physical phone or production SLO. Two short travel phrases were alternated, six samples per language. Repeated inputs can benefit from SDK caching; this is not a diverse warm-workload or p95 benchmark. Translation output was checked for successful local execution, not scored by native speakers.

| Target from English | First request after process restart | Remaining five requests | Process PSS after requests |
|---|---:|---:|---:|
| French | 577 ms | 26–45 ms | 207 MiB |
| Hindi | 541 ms | 30–38 ms | 182 MiB |
| Japanese | 637 ms | 31–38 ms | 188 MiB |
| Thai | 395 ms | 30–101 ms | 218 MiB |
| Spanish | 432 ms | 29–110 ms | Not sampled |

QA app private directory after this sequence: ~210 MiB, including models and app data, excluding installed APK. This is not per-language storage. PSS includes the React Native app; no long-duration leak conclusion is justified by these snapshots.

## Reproduction

Use Node 22 and Java 17. From `apps/mobile`:

```sh
npm test -- --silent
npx tsc --noEmit
npm run lint
npx expo-doctor
```

Android: from `apps/mobile/android`, `./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain` uses the normal router entry and configured release minification. Earlier QA builds explicitly disabled minification and used the local `qa.init.gradle`; do not distribute those APKs.

The native runner `output/offline-translation-review/run_integrated_android.py` requires the QA application and an isolated emulator with readable private app storage. It assumes French/German/Spanish are initially absent; use a fresh isolated QA install for a repeat. The QA entry source is kept in `native-entry.js`; it is not part of the normal app entry point. Never target a user's phone with this reset-oriented QA harness.

For unsigned iPhone compilation, from `apps/mobile/ios`:

```sh
xcodebuild -workspace Roamie.xcworkspace -scheme Roamie -configuration Debug \
  -sdk iphoneos -destination 'generic/platform=iOS' \
  -derivedDataPath /tmp/roamie-offline-ios-device CODE_SIGNING_ALLOWED=NO -jobs 2 build
```

## Release gates still required

1. Physical iPhone and mid-range Android: download from Profile, terminate, airplane mode, reopen, translate in both directions. Exercise the sign-in/loading entry too. Native additions require a new binary, never JS-only OTA.
2. Actual speech model/voice installation, denied/revoked permissions, tap-to-talk, cancellation while permissions are pending, background/interruption, and offline playback. The emulator has no installed recognition model or TTS voice; speech E2E is **not verified**.
3. UI at small width, large font scale, keyboard open, VoiceOver/TalkBack; download errors, full storage, close/reopen during download and OS process eviction. Full Profile UI runtime checks on both platforms remain required.
4. At least 30 distinct travel sentences per chosen pair on real phones, cold/warm p50/p95, both directions and non-English pairs; native-speaker quality review for names, numbers, medical phrases and negation. Compare online/offline quality separately from speed.
5. Sustained translation/pair switching, memory trend, thermal/battery effects and low-memory recovery. Measure actual per-pack storage and download duration on representative networks.
6. Captive portal, Wi-Fi without internet, network transitions and reconnection. Confirm no cloud inference in airplane mode and no indefinite model/download operations on iOS. Native SDK callback timeout/resource cleanup needs further review; the JS speech readiness timeout alone does not settle that question.
7. Verify ML Kit attribution against current Google translation terms, signed release builds, native runtime compatibility/versioning and existing online flows before store distribution.

No production deployment, cloud infrastructure change, CUD change, commit or push was performed for this validation. A successful automated suite does not establish zero production risk.
