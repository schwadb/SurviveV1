# Device testing checklist

Native features (app lock, bill reminders, file pickers, share-sheet exports,
scrypt-derived encrypted backups) can only be verified on a real device or
emulator in a **dev build** — NOT Expo Go, which since SDK 53 limits scheduled
notifications and cannot surface Face ID permission strings.

Build a dev client with one of:

```bash
npx expo run:android           # local, needs Android Studio + SDK
npx expo run:ios               # local, needs Xcode (macOS)
eas build --profile development --platform android   # cloud
eas build --profile development --platform ios       # cloud
```

Run this checklist on **each** of Android and iOS. Record the OS version each
line was verified on in the "Verified" column.

| # | Check | Verified (Android) | Verified (iOS) |
|---|-------|--------------------|----------------|
| 1 | Cold start seeds demo data; all 5 tabs render; dark mode follows system | | |
| 2 | App lock: enable → background → reopen → biometric prompt; cancel → locked screen with retry; success → unlocked; disable → no prompt | | |
| 3 | Bill reminders: enable → accept permission → scheduled list has one entry per unpaid upcoming bill; mark a bill paid → entry gone; a due-tomorrow bill fires at 09:00; notification arrives while app is FOREGROUND | | |
| 4 | Statement import: pick a real `.qfx`/`.csv` from Files/Downloads; rows import; re-import skips duplicates | | |
| 5 | CSV export and both plain + encrypted backup exports open the system share sheet; the file opens in another app (Sheets/Files) | | |
| 6 | Encrypted restore: wrong passphrase shows inline error; right passphrase restores after the confirm step; scrypt derivation does not visibly freeze the button (> 1s → file a bug to lower N or add a spinner) | | |
| 7 | Amount fields open the decimal pad; open sheets are not obscured by the keyboard (iOS risk) | | |
| 8 | Rotation / iPad (`supportsTablet: true`): no crashes, layout usable | | |

## Notes

- `/android` and `/ios` are gitignored on purpose (Continuous Native
  Generation). Never commit prebuild output — all native config lives in
  `app.json` + config plugins. If a fix seems to need editing a generated file,
  the correct fix is a plugin entry.
- `NSFaceIDUsageDescription` is mandatory (in `app.json` → `ios.infoPlist`);
  without it iOS Face ID requests crash at runtime.
- Android 13+ needs the runtime `POST_NOTIFICATIONS` permission, handled by
  `expo-notifications`' `requestPermissionsAsync` — but only in a build made
  after the plugin was registered. Rebuild the dev client after any plugin
  change.
- `versionCode` (Android) and `buildNumber` (iOS) must increment for every
  store upload — bump per release, not per commit.
- New Architecture is the default in SDK 57; all dependencies used here support
  it. Do not disable `newArchEnabled` as a "fix" without recording why.
