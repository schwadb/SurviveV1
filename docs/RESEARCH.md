# Competitive research: Monarch Money, YNAB, PocketGuard, Goodbudget

Research snapshot: July 2026. Sources: NerdWallet, PCMag, Forbes Advisor, CNBC Select,
Bankrate, Engadget, WSJ Buy Side, Motley Fool, vendor pricing pages, App Store /
Google Play listings, and user communities (r/ynab, r/MonarchMoney, r/PocketGuard).

## Pricing & positioning

| App | Free tier | Paid | Positioning |
|---|---|---|---|
| **Monarch Money** | None (7-day trial) | Core $14.99/mo or $99.99/yr; Plus $199/yr | Automated, visual, whole-net-worth aggregator; best for couples/households |
| **YNAB** | None (34-day trial) | $14.99/mo or $109/yr, single tier | Opinionated zero-based envelope method; behavior change + education |
| **PocketGuard** | Very limited (2 categories, 2 linked accounts, 5 rules) | Plus $12.99/mo, $74.99/yr, or $149.99 lifetime | "Left to Spend / In My Pocket" safe-to-spend number; best for overspenders |
| **Goodbudget** | Genuine free tier (20 envelopes, 1 account, 2 devices, 1yr history) | Premium $10/mo or $80/yr | Digital envelope discipline; manual-first; household sharing |

## Ratings

| App | iOS | Android | Review-site verdicts |
|---|---|---|---|
| Monarch | 4.9★ (~98K) | 4.7★ (~17.6K) | PCMag 4.0 "Excellent"; Forbes 4.8; CNET "Best for Couples" |
| YNAB | 4.8★ (~61K) | 4.7★ (~31K) | WSJ "Best for first-time budgeters"; Bankrate + NerdWallet featured |
| PocketGuard | 4.6★ (~7.7K) | 4.5★ (~2.9K) | PCMag 4.0; Forbes 4.5 "Best for tracking spending"; CNBC "Best for overspenders" |
| Goodbudget | 4.6★ (~13K) | 3.3★ (~19K) | CNBC "Best for beginners"; Bankrate "Best for envelope budgeting" |

## What each app is loved for (features worth stealing)

- **YNAB** — zero-based "give every dollar a job" (Ready to Assign), envelope
  reallocation ("roll with the punches"), category targets, reconciliation, offline
  manual mode (privacy), Age of Money, per-category rollover, loan payoff calculator.
- **Goodbudget** — envelope rollover, household sync across devices, debt tracking,
  simplicity; a genuinely usable free tier.
- **PocketGuard** — the single "In My Pocket / Left to Spend" number, "Pace"
  overspend prediction, bill tracker + negotiation, debt payoff plans, lifetime pricing.
- **Monarch** — net-worth dashboard, investment tracking, best-in-class reports,
  transaction Rules engine, recurring/subscription detection, goals with progress,
  unlimited household collaborators, CSV import/export, AI assistant.

## Top complaints (defects to avoid)

1. **Bank-sync unreliability is the #1 complaint for every app that has sync**
   (Plaid reauth loops, duplicates, months-long outages). → A local-first, manual +
   CSV app avoids the top churn driver entirely and doubles as a privacy feature.
2. Paywalled essentials / shrinking free tiers (PocketGuard free tier "nearly
   unusable"; YNAB price-hike backlash; "no lifetime option" complaints for Monarch).
3. Goodbudget: **no transaction search**, dated UI, weak Android app.
4. Monarch: no proactive overspend prevention, no undo when reallocating.
5. YNAB: steep learning curve, confusing credit-card handling.

## Consensus must-haves from 2026 "best budgeting app" roundups

(NerdWallet, Forbes, CNBC Select, Bankrate, Engadget methodology sections)

1. Transaction tracking with automatic categorization + custom categories/rules
2. Forward-looking planning (zero-based or envelope), not just spend history
3. Bill tracking, due dates, reminders
4. Savings goals and debt tools
5. Reports: spending by category, cash flow, net worth
6. Household sharing
7. iOS + Android + web availability
8. CSV import/export; user owns their data
9. Security/privacy
10. Fair pricing (free tier valued highly)

## How Survive Budget maps to the research

| Must-have / signature feature | Source app | In Survive Budget |
|---|---|---|
| Zero-based "Ready to Assign" | YNAB | ✅ Budget tab header + Home card |
| Envelopes with per-category rollover | Goodbudget/YNAB | ✅ rollover toggle per envelope |
| Move money between envelopes | YNAB "roll with the punches" | ✅ Move Money sheet |
| "In My Pocket" safe-to-spend | PocketGuard | ✅ Home hero number |
| "Pace" overspend prediction | PocketGuard | ✅ spending-pace meter on Home |
| Bill tracker w/ due dates, overdue flags, mark-paid | PocketGuard/Monarch | ✅ Bills section + Home upcoming list |
| Bill due-date reminders/notifications | consensus must-have #3 | ✅ local notifications, due-date + T-3 heads-up |
| Net worth dashboard + trend | Monarch | ✅ Accounts section + Reports chart |
| Accounts incl. credit/loan/investment, on-budget vs tracking | Monarch/YNAB | ✅ |
| Reports: category donut, income vs spending, savings rate | Monarch | ✅ Reports tab |
| Recurring/subscription detection | Monarch | ✅ payee-frequency detection in Reports |
| Auto-categorization rules | Monarch/PocketGuard | ✅ rules engine + retroactive apply |
| Category targets + Auto-Assign | YNAB Targets | ✅ monthly targets, one-tap auto-assign from RTA |
| Transaction search & filters | (Goodbudget's gap) | ✅ full-text search + account/category filters |
| Savings goals with progress | all four | ✅ goals with contribute/withdraw |
| Debt payoff planner (avalanche/snowball) | PocketGuard Plus / YNAB loan calculator | ✅ simulator with strategy comparison + payoff curve |
| Statement/file import (CSV, OFX/QFX) & export | Monarch/YNAB/Goodbudget bank-file import | ✅ file picker + paste, duplicate-skip, rules auto-categorize |
| Overspend warnings with reserved status colors | PocketGuard | ✅ envelope "overspent — tap to cover" |
| Dark mode | table stakes | ✅ system/light/dark |
| Privacy / manual-first, offline | YNAB manual mode | ✅ 100% on-device, no bank credentials |

Deliberately out of scope (roadmap): real bank aggregation (the #1 complaint
driver; would need Plaid + a backend), multi-device household sync, AI assistant,
investment holdings detail.
