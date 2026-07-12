# PLAN: Native device builds & release readiness

> **Status: ✅ COMPLETED** — implemented and verified (prebuild generates both platforms; CI gates it).

**Rank: 1 of 5 (do this first).** The product goal is an Android/iOS app, yet
every native code path shipped so far — app lock (expo-local-authentication),
bill reminders (expo-notifications), file pickers, share-sheet exports — has
only ever been verified through the web build. `app.json` has **no
`ios.bundleIdentifier` and no `android.package`**, so a native binary cannot
even be produced today. Until this lands, all native features are latent risk.

## Goal

Produce installable dev builds for Android and iOS, verify every native
feature on a device/emulator against a written checklist, and make the app
store-submittable (identifiers, versioning, permission strings, icons).

## Exact files to touch

- `app.json` — add:
  - `expo.ios.bundleIdentifier: "com.survive.budget"`,
    `expo.ios.buildNumber: "1"`,
    `expo.ios.infoPlist.NSFaceIDUsageDescription` (app-lock prompt text).
  - `expo.android.package: "com.survive.budget"`,
    `expo.android.versionCode: 1`.
  - `expo.plugins`: ensure `expo-local-authentication` (with
    `{"faceIDPermission": "Unlock Survive Budget with Face ID."}`) and
    `expo-notifications` (icon/color) entries alongside the existing
    `expo-sharing` plugin. Read the versioned plugin docs first:
    https://docs.expo.dev/versions/v57.0.0/sdk/local-authentication/ and
    /sdk/notifications/ (CLAUDE.md rule).
- `eas.json` — new: `development` (devClient, internal), `preview` (internal
  APK/simulator), `production` profiles.
- `docs/DEVICE-TESTING.md` — new: the manual verification checklist below.
- `README.md` — "Running it" section gains dev-build instructions
  (`npx expo run:android` / `run:ios`, or `eas build --profile development`).
- `package.json` — script `"prebuild:check": "expo prebuild --no-install --clean --platform android"`
  used by CI to prove native projects generate.
- `.github/workflows/budget-ci.yml` — add the prebuild check step (it needs no
  SDKs; it only generates the native projects).

## Step-by-step implementation order

1. Edit `app.json` (identifiers, versioning, plugins, permission strings).
2. Run `npx expo prebuild --no-install --clean` locally and fix every warning
   it prints — this is the fastest signal that plugin config is wrong, and it
   requires no Android SDK/Xcode.
3. Add `eas.json` and the CI prebuild step; commit.
4. On a machine with Android Studio (or via `eas build --profile development`):
   build, install, and walk `docs/DEVICE-TESTING.md`.
5. Fix whatever the checklist surfaces (file bugs per item; do not batch-fix
   blind), re-run the checklist, then bump docs to record the verified
   OS versions.

## Device-testing checklist (contents of docs/DEVICE-TESTING.md)

For each of Android and iOS, in a **dev build** (not Expo Go — SDK 53+ limits
notifications there):

1. Cold start seeds demo data; all 5 tabs render; dark mode follows system.
2. App lock: enable → background the app → reopen → biometric prompt; cancel →
   locked screen with retry; success → unlocked. Disable → no prompt.
3. Bill reminders: enable toggle → accept permission →
   `getAllScheduledNotificationsAsync()` (log in dev menu or temporary button)
   lists one entry per unpaid upcoming bill; mark a bill paid → entry gone;
   set a bill due tomorrow, verify the 09:00 notification fires (or use a
   short-fuse debug trigger); notification arrives while app is FOREGROUND
   (the handler exists for exactly this).
4. Statement import: pick a real `.qfx` from Files/Downloads; rows import;
   re-import skips duplicates.
5. CSV export and encrypted backup export open the system share sheet and the
   file opens in another app (Sheets / Files).
6. Encrypted backup restore: wrong passphrase shows the inline error; right
   passphrase restores after the confirm step. Time the scrypt derivation —
   if the Unlock button feels frozen > 1s on a mid-range phone, file a bug to
   lower N or add a spinner.
7. Keyboard: amount fields open the decimal pad; sheets are not obscured by
   the keyboard (iOS is the risk; if obscured, wrap Sheet content in
   `KeyboardAvoidingView` — file it, don't hotfix untested).
8. Rotation/tablet (iPad `supportsTablet: true`): no crashes, layout usable.

## Edge cases a weaker model would miss

- **`/android` and `/ios` are gitignored on purpose** (Continuous Native
  Generation). Do NOT commit the prebuild output; config lives entirely in
  `app.json` + plugins. If a fix seems to require editing a generated file,
  the correct fix is a config-plugin entry.
- **Expo Go is not a valid test bed** for this checklist: notifications are
  limited in Go since SDK 53, and Face ID permission strings only exist in a
  real build. Verifying in Go produces false confidence.
- **`NSFaceIDUsageDescription` is mandatory** — without it, iOS Face ID
  requests crash the app at runtime; Touch ID/passcode-only devices mask the
  bug in testing.
- **Android 13+ requires the runtime POST_NOTIFICATIONS permission** — the
  expo-notifications `requestPermissionsAsync` path handles it, but ONLY in a
  build made after the plugin is registered; a stale dev client silently lacks
  the permission. Rebuild after every plugin change.
- **The scrypt timing item (#6)** is a device-only concern — it is ~50ms in
  Node/desktop Chrome and 100–400ms on phones; nobody will catch it on web.
- **`versionCode`/`buildNumber` must increment monotonically** for every store
  upload; note in the README that these bump per release, not per commit.
- **New Architecture is the default in SDK 57** — if a build failure mentions
  Fabric/TurboModules, do not disable newArchEnabled as a "fix" without
  recording it; all deps used here are SDK-57-managed and support it.
- **CI can't run emulators** here — that's why the CI step is `expo prebuild`
  (config validity) and the runtime checklist is a documented manual gate.

## Acceptance criteria

1. `npx expo prebuild --no-install --clean` completes with zero warnings on a
   clean checkout; CI includes and passes this step.
2. `app.json` contains both platform identifiers, versioning, and the Face ID
   usage description; `eas.json` exists with the three profiles.
3. `docs/DEVICE-TESTING.md` exists with the checklist above; after a device
   pass, each line is marked with the OS version it was verified on.
4. All existing verification still green: 80+ unit tests, 3 e2e drives,
   `tsc --noEmit`, web export.
