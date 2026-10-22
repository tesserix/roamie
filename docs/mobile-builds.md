# Mobile builds and TestFlight

Project: https://expo.dev/accounts/tesserix-org/projects/roamie

All cloud profiles use the authenticated HTTPS API. Native configuration and SDK
changes require a new binary. Expo Go cannot test the complete app or its native
card-payment integration.

| Profile | iOS | Android | Metro |
| --- | --- | --- | --- |
| development | Registered devices; development client | APK | Required |
| preview | Registered devices; standalone internal build | APK | Not required |
| preview-simulator | Standalone simulator build; no Apple signing | Select iOS only | Not required |
| production | Store-signed binary; TestFlight eligible | AAB | Not required |

**Mobile Build** is manual and waits for the selected EAS build. Its reusable
verification job runs locked installation, tests, TypeScript, lint, Expo Doctor,
release-configuration tests and platform exports before building. It never
submits to a store. Android preview APKs can be installed directly on a phone.
An internal iOS preview needs a registered UDID; use TestFlight for other testers.

## TestFlight setup

1. Create Roamie's own App Store Connect app for `app.tesserix.roamie`.
2. Set the repository variable `ROAMIE_ASC_APP_ID` to its numeric Apple ID.
3. Set `EXPO_TOKEN` with access to `tesserix-org` and configure Roamie's Apple
   distribution certificate, provisioning profile and App Store Connect API key
   using `npx eas-cli@22.2.0 credentials --platform ios`. Credentials belong in
   EAS or the approved secret store, never in Git or chat.
4. Configure the GitHub `testflight` environment and any required reviewers.
5. Run **TestFlight** on `main`. Preflight rejects a missing/non-numeric app ID
   before spending a build. Verification runs, then a production iOS build is
   awaited and its exact build ID is submitted. The workflow never uses `latest`.
6. Check submission completion and Apple's processing in App Store Connect;
   assign the build to the intended internal testing group. External testers may
   need Apple's beta review. App Store release remains a separate reviewed action.

The workflow creates its submission profile only inside the runner from the
repository variable. No other product's store ID or provisioning profile is reused.
EAS maintains remote build numbers and increments production artifacts.

### 2026-10-12 internal TestFlight update

Apple accepted **0.1.0 (5)**, EAS build `2303da1b-638d-49d3-9666-ec05b8e5becc`,
Apple build `192c4321-17f6-4cee-a229-daad45069fa5`. Processing is VALID; internal
beta state is IN_BETA_TESTING with automatic notification enabled. External
state is READY_FOR_BETA_SUBMISSION while build 3 remains WAITING_FOR_BETA_REVIEW.
No review was withdrawn and no public App Store release was performed.

Build 5 includes saved destination-coordinate reuse, per-city readiness deadlines,
endpoint-specific timeout messages, selected-city share cards and itinerary PDF
margin/day-break fixes. It retains the two-way translated Show them behavior.
It does not include the later unsupported-weather wording/source candidate.
The manager server hotfix is in ai-agents PR #83 and remains blocked by GitHub
Actions billing; build 5 does not resolve that deployed server failure. Hotel and
transport estimates are still unverified allocations, not live supplier quotes.

## Translation fix beta: 0.1.0 (4)

On 12 October 2026, the user authorized the next TestFlight release with the
corrected bidirectional “Show them” display. Production build
[`bdbe9176-ad91-4325-b670-f75ed6fd2716`](https://expo.dev/accounts/tesserix-org/projects/roamie/builds/bdbe9176-ad91-4325-b670-f75ed6fd2716)
finished and automatically uploaded to Apple. Apple build
`3b58c945-2a2b-4889-ae98-4df1100d92b3` is `VALID`, with `IN_BETA_TESTING`
internally and `READY_FOR_BETA_SUBMISSION` externally. The existing **Internal
Testing** and **Roamie External** groups both contain build 4; auto-notification
is enabled. Internal group membership and existing app access were preserved.

Apple rejected build 4's external review request with
`ENTITY_UNPROCESSABLE.ANOTHER_BUILD_IN_REVIEW`: build 3 remains in beta review.
Submit build 4 once that review completes. Assigning a build to the external
group does not make it installable before Apple's approval.

The IPA passed strict code-signature verification. It identifies
`app.tesserix.roamie`, version `0.1.0`, build `4`, team `2CRHRRYBPL`, an App Store
profile without device restrictions, debugging disabled, and no non-exempt
encryption. Production EAS configuration uses the authenticated public HTTPS API.
This beta does not include later trip share-card/PDF corrections or a production
backend rollout. Testing notes explicitly describe trip costs as unverified
allocations while pricing realism and the public generation timeout are addressed.

See [iOS trip QA](ios-trip-qa-2026-10-12.md) for the actual simulator checks.

On 2026-10-12, Roamie was registered as `app.tesserix.roamie` under Apple team
**Tesserix Pty Ltd (`2CRHRRYBPL`)**, matching HomeChef and Mark8ly. EAS now stores
Roamie's own App Store provisioning profile, the existing team's distribution
certificate, and the shared App Store Connect submission key. No certificate or
API key was rotated. The production-profile candidate is **0.1.0 (2)**:
[EAS build](https://expo.dev/accounts/tesserix-org/projects/roamie/builds/78e113b7-d662-4b3c-9940-a8fb4bda88d2).
Its source archive includes the current local mobile changes; no commit or push
was made. EAS completed the signed build successfully at 01:22 UTC. Submission
`9ca0fb76-e77e-46e5-b7ac-0d168decfad0` succeeded, and Apple processed build
`15d4f889-191d-48c6-b051-4b27642b114f` as `VALID`. Its export declaration is set
to no non-exempt encryption. Apple reports `IN_BETA_TESTING` internally
and `READY_FOR_BETA_SUBMISSION` externally for build 2. External review uses the
newer build 3 described below.
The downloaded IPA passed `codesign --verify --deep --strict`; its embedded
profile matches the Tesserix team, is an App Store profile with debugging
disabled, and the compiled Info.plist confirms the bundle ID, version/build and
updated microphone permission text. The local artifact is
`/tmp/roamie-testflight-0.1.0-2.ipa`.

The user created Roamie's [App Store Connect record](https://appstoreconnect.apple.com/apps/6821785215/testflight/ios),
ID **6821785215**. Both `submit.production.ios.ascAppId` and repository variable
`ROAMIE_ASC_APP_ID` now use that ID. Browser access remains blocked by the saved
permission review; authorized Apple API operations supplied the status above.
The beta targets the existing live API; this build does not roll out the pending
API or gateway changes.

On 2026-10-12, the requested testers were added and their group membership
was read back from Apple:

| Tester | Group | Apple state | Install availability |
| --- | --- | --- | --- |
| samyak.rout@gmail.com | Roamie Internal | INVITED | Build 0.1.0 (2), after accepting the invitation |
| mahesh.sangawar@gmail.com | Roamie Internal | INVITED | Build 0.1.0 (2), after accepting the invitation |
| lipsha03@gmail.com | Roamie External | NOT_INVITED | Build 0.1.0 (3) assigned; awaiting Apple's beta review |
| unidevidp@gmail.com | Roamie External | NOT_INVITED | Build 0.1.0 (3) assigned; awaiting Apple's beta review |
| lipsharout1988@gmail.com | Roamie External | NOT_INVITED | Build 0.1.0 (3) assigned; awaiting Apple's beta review |
| rjpari03@gmail.com | Internal Testing | INVITED | Build 0.1.0 (3), after accepting the invitation |

Internal group `312552c1-a2dc-4859-a480-dcfbc074cfc7` contains builds 2 and 3.
External group `547bdc1b-85bb-46e6-87ab-e8f6feba2dee` contains build 3. No
App Store Connect staff roles were created or changed. Invitations do not prove
email delivery, acceptance or a successful device install.

At the user's request, Fe3dr customer/vendor and Mark8ly admin groups were
compared. Fe3dr has Samyak and Mahesh in **Internal Testing**, and
`rjpari03@gmail.com` in **Sales**. Mark8ly has all three in **Internal Testing**.
Roamie's matching **Internal Testing** group is
`d7756c2c-74bf-4b72-9fb1-4ad54c87d4ac`, with `hasAccessToAllBuilds=true`, the
same feedback/Mac/Vision settings, all three testers and builds 2 and 3. Existing
Roamie groups were retained. Roamie was added to the third tester's existing
Sales-role account's allowed apps; the existing app list and role were preserved.
The Apple readback shows Mahesh `INSTALLED`, Samyak `INVITED` and
`rjpari03@gmail.com` `INVITED`. Lipsha's addresses and Unidev are not members of
the source internal groups; their existing external beta-review gate remains.

A dedicated reviewer identity `roamie-review@tesserix.app` was created and its
password checked against the identity provider. Native email sign-in succeeded
against the live API on an isolated iOS simulator, the authenticated session
restored after terminating and relaunching the app, and Bonjour translated to
Hello. Simulator text/paste input initially submitted the wrong password;
verified direct keystrokes completed the login. No password or identity-provider
policy was changed. Build 2 has social sign-in only.

The email-enabled **0.1.0 (3)** build
[`024f2d79-18e8-4bfd-ab23-5cf5be28a30e`](https://expo.dev/accounts/tesserix-org/projects/roamie/builds/024f2d79-18e8-4bfd-ab23-5cf5be28a30e)
finished successfully and submission `f240d8e2-448b-4621-ae46-2de11a0a8c20`
uploaded it to App Store Connect. Apple processing completed as `VALID`. Its downloaded
IPA passed strict code-signature verification and confirms build 3, the Tesserix
team, disabled debugging, an App Store profile and
`ITSAppUsesNonExemptEncryption=false`.

Apple's protected beta review metadata now contains the demo credentials and
complete contact fields reused from Tesserix's existing HomeChef store review
contact. Credentials were compared in memory on readback and never printed.
English (Australia) beta description and feedback email are saved, with the
existing company-wide privacy policy at https://tesserix.app/privacy. This does
not certify the app's full privacy/account-deletion compliance for public release.
External beta review was submitted for Apple build
`34053ade-e366-408e-95c8-8cd313e2e512`. Review submission with the same ID is
`WAITING_FOR_REVIEW`; the build reports `WAITING_FOR_BETA_REVIEW` externally and
`IN_BETA_TESTING` internally. `autoNotifyEnabled=true` is set for build 3. External
testers remain `NOT_INVITED` while Apple review is pending; submission is not
approval or proof of an available external install. Samyak is `INVITED` internally
and Mahesh is `INSTALLED`.

For this candidate, all 167 mobile tests in 39 suites, TypeScript, lint, six
release/configuration tests, all 21 Expo Doctor checks and all platform exports
passed. Android native reviewer login and physical-device validation remain
outstanding. QA screenshot: `/tmp/roamie-reviewer-live-translation.png`.

## Local verification

Use the Node 22 version pinned in `.nvmrc`. From `apps/mobile`, run:

```sh
npm ci
npm test
npx tsc --noEmit
npm run lint
npx expo-doctor@1.20.4
npx expo export --platform all
```

For an isolated local debug API, run `AUTH_ENABLED=false PORT=8085 cargo run`
from the repository root, then start the development client with:

```sh
NODE_OPTIONS=--dns-result-order=ipv4first \
EXPO_PUBLIC_API_URL=http://localhost:8085 EXPO_PUBLIC_AUTH_ENABLED=false \
npx expo start --dev-client --localhost --port 8097
```

The IPv4 option prevents Metro binding only to `::1` while its native bundle URL
uses `127.0.0.1`. Debug bypass requires both a development build and a loopback
API. It is never available in release builds. After SDK patch updates, existing
generated iOS Pods may require `pod update ExpoModulesCore ExpoModulesWorklets
--no-repo-update`; EAS uses a clean native generation.

For local Android QA, use Java 17 and an SDK with the API 36 Google APIs ARM64
system image. The review used a Pixel 7 AVD named `roamie_qa_api36`. From
`apps/mobile`, generate native files with Expo and build the development client:

```sh
JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
ANDROID_HOME="$HOME/Library/Android/sdk" npx expo prebuild --platform android
cd android
JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
ANDROID_HOME="$HOME/Library/Android/sdk" ./gradlew app:assembleDebug \
  -PreactNativeArchitectures=arm64-v8a -PreactNativeDevServerPort=8097 \
  --max-workers=2 -Djava.net.preferIPv4Stack=true \
  -Dorg.gradle.internal.http.socketTimeout=30000 \
  -Dorg.gradle.internal.http.connectionTimeout=15000
```

Install `android/app/build/outputs/apk/debug/app-debug.apk` from `apps/mobile`
using your SDK's `adb install -r`. Reverse ports 8085 and 8097 to the selected
emulator, then open the Roamie development client with Metro's localhost URL.
Native directories are generated and ignored; make native configuration changes
through Expo configuration. A physical Android phone needs its own reachable
development API and authentication configuration; the emulator's loopback debug
setup is not a phone release profile.

Run `node --test scripts/ci/*.test.mjs` and `actionlint` at the repository root.
A successful build does not verify Google/Apple sign-in, live OCR/JEV accuracy,
notifications, physical-device permissions or Android visual behavior.

Weather follow-up (2026-10-12): local provider attribution, precipitation label
and forecast-window guidance changes are not in TestFlight 0.1.0 (5). The
Open-Meteo backend adapter is also local only, pending commercial key and a
compatible CI/GitOps release. Live evaluation succeeded for Tokyo and Kyoto;
this is not evidence that production has switched providers.
