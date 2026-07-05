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
- **CSV import (paste) and export** (share sheet on mobile, download on web)
- **Dark mode** (system/light/dark), colorblind-safe validated chart palette
- **Privacy-first**: 100% on-device via AsyncStorage — no bank logins, no cloud, no ads

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

- `npx tsc --noEmit` — strict TypeScript, clean
- `npx expo export --platform web` — production bundle builds
- Playwright end-to-end drive of the web build: every tab, add/search/persist
  transaction, envelope assign, move money, mark bill paid, goal contribution,
  dark mode — zero console/page errors
