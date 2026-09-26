# Mobile builds

Roamie uses the shared Tesserix EAS builder, following Kora's reusable-workflow
pattern and Mark8ly's selectable build profiles.

Project: https://expo.dev/accounts/tesserix-org/projects/roamie

Run **Mobile Build** from GitHub Actions and choose iOS, Android, or both.
Builds are manual, serialized, and wait for completion. They do not submit to
either store.

| Profile | Distribution | Android output |
| --- | --- | --- |
| development | Internal development client; Metro required | APK |
| preview | Internal standalone app | APK |
| production | Store-signed app; remote version increments | AAB |

All cloud profiles use https://roamie-api.tesserix.app and enable authentication.
The local auth bypass is only for debug builds using a loopback API; local
environment files are excluded from Git. Native changes need a new binary.

## Credentials

Set the repository or an accessible organization secret named EXPO_TOKEN with
access to tesserix-org. Signing credentials must be registered in this EAS
project: Android keystore, and Apple distribution certificate/provisioning
profile. Internal iOS builds also require registered devices.
Use EAS credentials interactively with the authorized account to finish setup.
Never commit signing files or service-account keys.

Store submission remains disabled until Roamie's own App Store Connect and
Play Console records and submission credentials are configured. Do not reuse
another product's store app IDs.

## Validation and scope

Use Node 22.19.0 (nvm use); the repository and mobile directory pin it in .nvmrc.
Node 26 caused Metro websocket disconnections in the iOS simulator; switching
to Node 22 removed the development warning without suppressing LogBox.

Run npm ci, npm test -- --runInBand, npx tsc --noEmit, npx expo lint, and
npx expo-doctor from apps/mobile. Run node --test scripts/ci/mobile-release.test.mjs
and actionlint from the repository root.

The mobile planner and memory screens are included, but the destination,
planning, group, and video-rendering services from the development worktree
are not deployed by this mobile change. A successful binary build alone does
not establish end-to-end feature or social-login readiness.
