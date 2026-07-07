# Survive Budget 💸

A cross-platform (Android + iOS + web) personal budgeting app built with
**Expo / React Native + TypeScript**, designed from competitive research on the four
leading budgeting apps — Monarch Money, YNAB, PocketGuard, and Goodbudget.
See [docs/RESEARCH.md](docs/RESEARCH.md) for the full research report and the
feature-mapping table.

## Feature highlights

- **In My Pocket** (PocketGuard-style) safe-to-spend hero number with a
  **spending Pace** meter that warns when you're spending faster than the month passes
- **Zero-based envelope budgeting** (YNAB-style "Ready to Assign", Goodbudget-style
  rollover envelopes), grouped categories, move-money between envelopes,
  overspend flags
- **Transactions**: add/edit/delete, income & expense, pending/cleared, full-text
  search, account & category filters, date grouping
- **Auto-categorization rules** ("payee contains X → category Y") with retroactive apply
- **Recurring bills**: due dates, overdue flags, autopay labels, one-tap "mark paid"
  (creates the transaction)
- **Accounts & net worth**: checking/savings/cash/credit/investment/loan, on-budget vs
  tracking, computed balances
- **Savings goals** with progress bars and contribute/withdraw
- **Reports**: spending-by-category donut, 6-month income-vs-spending bars, savings
  rate, net-worth trend line, recurring/subscription detection
- **Statement import**: pick a bank/credit-card export file — CSV or OFX/QFX (Quicken) —
  or paste CSV; automatic duplicate detection makes re-importing overlapping months safe,
  and rules auto-categorize imported rows. CSV export via share sheet (mobile) or download (web)
- **Quick budgeting**: "Copy last month" one-tap budget fill; move-money validated
  against the source envelope's available balance
- **Uncategorized inbox**: one-tap filter chip in Activity showing the count of
  transactions still needing a category
- **Backup & restore**: full-data JSON backup exported as a real file (share sheet on
  mobile, download on web) and restored via file picker with structural validation
- **App lock**: Face ID / fingerprint / device passcode required on launch and on
  return from background (expo-local-authentication; Android & iOS)
- **Bill reminders**: opt-in local notifications at 9:00 on due dates plus a
  3-days-ahead heads-up for bills without autopay (expo-notifications; Android &
  iOS — full fidelity needs a dev build, not Expo Go)
- **Dark mode** (system/light/dark), colorblind-safe validated chart palette
- **Privacy-first**: 100% on-device via AsyncStorage — no bank logins, no cloud, no ads

## Security model

- All data stays on-device (AsyncStorage); the app makes zero network requests.
- Optional biometric/passcode app lock gates the UI on cold start and resume.
- Statement and backup files are read locally via the OS file picker; nothing is uploaded.
- Backup JSON files are unencrypted by design (portability) — the UI warns users to
  store them safely. Encrypted backups via expo-secure-store-derived keys are on the
  roadmap.

## Running it

```bash
npm install
npm run web       # web preview
npm run ios       # iOS simulator (or Expo Go on device)
npm run android   # Android emulator (or Expo Go on device)
```

The app ships with demo data (generated relative to today) so every screen is
populated on first launch. Use **More → Danger zone** to clear it or re-seed.

## Architecture

```
App.tsx                    theme + custom bottom-tab navigation
src/
  theme.ts                 design tokens, light/dark, validated chart palette
  types.ts                 domain model (cents-integer money)
  store.ts                 zustand + AsyncStorage persistence
  data/seed.ts             demo dataset generator
  logic/budget.ts          pure budget math (envelopes, RTA, IMP, net worth, reports)
  utils/                   money/date/CSV helpers
  components/              ui kit, SVG charts, form sheets
  screens/                 Home, Budget, Transactions, Reports, More
```

No navigation or chart libraries — the tab bar is a lightweight custom component and
charts are hand-rolled with `react-native-svg`, keeping the dependency surface small
and identical across Android, iOS, and web.

## Verification

```bash
npm run typecheck   # strict TypeScript
npm test            # vitest unit suite (budget math, parsers, backup)
npm run e2e         # builds the web bundle and runs 3 Playwright drives
```

The e2e drives cover: every tab and core flow (add/search/persist transaction,
envelope assign, move money, mark bill paid, goal contribution, dark mode,
reload persistence); statement import (QFX + CSV files, duplicate-skip on
re-import, rule auto-categorization); and the improvement flows (uncategorized
filter, date quick-chips, over-move blocked, copy-last-month, backup export →
clear-all → restore round-trip, invalid backup rejected). CI (`budget-ci`)
runs typecheck + unit tests + web export on every push.
