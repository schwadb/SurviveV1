# PLAN: Bill due-date reminders (local notifications)

**Rank: 2 of 5.** "Bill tracking, due dates, and reminders" is a consensus
must-have in every 2026 budgeting-app roundup (see `docs/RESEARCH.md` §
"Consensus must-haves", item 3). The app tracks bills and shows due/overdue
states in-UI, but never reminds the user — the single biggest remaining gap to
the paid apps, and explicitly listed as v1 roadmap ("push notifications").

## Goal

Opt-in local notifications on Android/iOS: for every unpaid bill, notify at
09:00 local time on the due date, plus a "due in 3 days" heads-up for bills
without autopay. No servers, no push tokens — purely local scheduling, matching
the app's privacy-first model. Web silently unsupported (settings row explains).

## Exact files to touch

- `package.json` / `app.json` — `npx expo install expo-notifications`; the
  install adds the config plugin entry automatically; verify `app.json` gets
  `"plugins": ["expo-sharing", "expo-notifications"]` (expo-sharing's plugin is
  already registered).
- `src/types.ts` — `Settings` gains `billReminders?: boolean` (optional — see
  edge cases: do NOT bump `SCHEMA_VERSION`).
- `src/logic/reminders.ts` — new, PURE module (no expo imports):
  `planBillReminders(bills, todayIso, horizonDays=60) → {billId, dateIso,
  hour, title, body}[]`.
- `src/services/notifications.ts` — new, the only file importing
  `expo-notifications`: permission request, Android channel setup,
  `syncScheduledNotifications(plan)` (cancel-all then schedule), all no-ops when
  `Platform.OS === 'web'`.
- `App.tsx` — a small effect component `<ReminderSync/>` inside providers:
  re-syncs when `bills` or `settings.billReminders` change.
- `src/screens/MoreScreen.tsx` — "Bill reminders" switch in the Security/new
  "Notifications" card; shows web-unsupported label like the app-lock row does.
- `src/logic/__tests__/reminders.test.ts` — unit tests (pure planner).
- `README.md`, `docs/RESEARCH.md` feature map — tick the roadmap item.

Before writing any expo-notifications code, read
https://docs.expo.dev/versions/v57.0.0/sdk/notifications/ (per CLAUDE.md rule).

## Step-by-step implementation order

1. Write `src/logic/reminders.ts` first (pure, testable):
   - For each bill and for this month + next month (2 iterations, mirroring
     `upcomingBills()` in `src/logic/budget.ts`): skip months present in
     `bill.paidMonths`; compute `dueIso = \`${m}-${String(dueDay).padStart(2,'0')}\``.
   - Emit due-date entry `{dateIso: dueIso, hour: 9, title: 'Bill due today',
     body: '<name> · $<amount> is due today'}` when `dueIso >= todayIso`.
   - For non-autopay bills also emit the T-3 entry when that date `>= todayIso`.
   - Cap at `horizonDays` and format money with the existing `fmt()`.
2. Unit-test the planner (cases below).
3. Write `src/services/notifications.ts`:
   - `ensurePermissions()`: `getPermissionsAsync` → if undetermined,
     `requestPermissionsAsync`; return boolean.
   - On Android call `setNotificationChannelAsync('bills', {name: 'Bill
     reminders', importance: AndroidImportance.DEFAULT})` once before scheduling.
   - `syncScheduledNotifications(entries)`:
     `await Notifications.cancelAllScheduledNotificationsAsync()` then for each
     entry `scheduleNotificationAsync({content: {title, body}, trigger:
     {type: SchedulableTriggerInputTypes.DATE, date: new Date(y, m-1, d, hour)}})`.
   - Set the foreground handler once at module init:
     `Notifications.setNotificationHandler({handleNotification: async () => ({
     shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false,
     shouldSetBadge: false})})` — without this, notifications that fire while
     the app is open are silently swallowed.
4. Add `<ReminderSync/>` in `App.tsx`: `useStore` select `bills` +
   `settings.billReminders`; in an effect, if enabled → `ensurePermissions()`
   then plan+sync; if disabled → cancel-all. Guard the whole body with
   `Platform.OS !== 'web'`.
5. Add the MoreScreen switch. When the user enables it and permission is
   denied, flip the switch back and show the existing `notify()` helper with
   "Enable notifications for Survive Budget in system settings."
6. Run `npx tsc --noEmit`, `npx expo export --platform web` (must still build —
   this catches accidental top-level native imports), unit tests, and the
   existing e2e drives (web must be unaffected).

## Edge cases a weaker model would miss

- **Do NOT bump `SCHEMA_VERSION`.** The zustand `persist` config uses
  `migrate: () => makeSeedData()`, so a version bump wipes user data to demo.
  Optional settings fields rehydrate fine without a bump (that's why `appLock`
  is optional too).
- **`new Date(dueIso)` parses as UTC midnight**, shifting the local date in
  negative-offset timezones. Build trigger dates from components:
  `new Date(year, monthIndex, day, 9, 0, 0)` — never from an ISO string.
- **Scheduling in the past throws/fires immediately** depending on platform.
  The planner must exclude entries with `dateIso < todayIso`, and same-day
  entries when it is already past 09:00 — pass "now" into the planner
  (`todayIso` + current hour) instead of reading the clock inside, or the unit
  tests become time-of-day dependent.
- **Cancel-all-then-reschedule is the only safe sync strategy.** Tracking
  individual notification ids across bill edits/deletes/mark-paid leaks
  stale reminders; the app has no other scheduled notifications, so
  `cancelAllScheduledNotificationsAsync` is safe. If a later feature schedules
  other notifications, this must switch to id-tracking — leave a comment.
- **Mark-paid must clear the reminder**: `payBill` mutates `bills`, so the
  `<ReminderSync/>` effect keyed on the `bills` array reference re-syncs
  automatically — do not subscribe to the whole store or the effect re-runs on
  every transaction and hammers the scheduler. Select exactly
  `s.bills` and `s.settings.billReminders`.
- **Expo Go limitation (SDK 53+):** remote push is unavailable in Expo Go and
  Android local scheduling can be limited; document that reminders need a dev
  build (`npx expo run:android|ios`) for full fidelity — do not "fix" this in
  code.
- **`dueDay` is constrained to 1–28** by `BillForm`, so no month-length
  handling is needed — but the planner should still clamp defensively since
  imported/restored backups are not re-validated per-field.
- **Foreground handler** (step 3) — the most commonly missed piece; without it
  the feature "works" in testing only when the app is backgrounded.
- **Permissions on iOS are one-shot**: if previously denied,
  `requestPermissionsAsync` returns denied without prompting; that's why the
  toggle must revert with guidance instead of appearing enabled-but-dead.

## Acceptance criteria

1. Unit tests: for a bill due day 15, today = 10th of month M → planner emits
   T-3 (12th) + due (15th) entries for non-autopay, due-only for autopay; a
   bill with M in `paidMonths` emits nothing for M but does for M+1; today =
   16th → only next-month entries; entries never include dates < today;
   horizon cap respected. All money strings formatted via `fmt` (e.g. `$16.50`).
2. `npx tsc --noEmit` and `npx expo export --platform web` pass; all existing
   e2e drives still print `"errors": []` (web untouched).
3. On an Android or iOS dev build (manual step, documented in README):
   enabling the toggle prompts for permission; `adb shell dumpsys notification
   --noredact | grep survive` (or Expo's `getAllScheduledNotificationsAsync()`
   logged in dev) shows one entry per unpaid upcoming bill; marking a bill paid
   removes its entries; disabling the toggle removes all.
4. The MoreScreen row on web shows an explanatory label instead of the switch.
