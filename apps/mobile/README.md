# Roamie mobile

Expo SDK 57 with Expo Router, React Native 0.86 and TypeScript. Screens live in
`src/app`; shared components and behavior live in `src/components` and `src/lib`.
The app includes native modules and the iOS card-payment shortcut, so use a
Roamie development build for complete device testing.

Use the Node 22 version in `.nvmrc`, then `npm ci` and `npm start`.
Run `npm test`, `npm run lint`, `npx tsc --noEmit` and
`npx expo-doctor@1.20.4` before building.

See [mobile builds and TestFlight](../../docs/mobile-builds.md) for internal
phone builds, standalone simulator builds, signing setup and the manual GitHub
workflows. See [production readiness](../../docs/production-readiness.md) for
verified behavior and outstanding release gates.

Local wallet and trip data are account-scoped. Tokens remain in SecureStore.
Uncertain OCR results require checking the original; importing a receipt or
statement requires the traveller's confirmation. SOS remains available without
sign-in. Production app calls always use authenticated HTTPS.
