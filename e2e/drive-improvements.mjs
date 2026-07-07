// Verify the improvement pass: uncategorized filter, date chips,
// copy-last-month, move-money validation, backup export/restore,
// security section on web, plus a smoke pass over all tabs.
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';

const HERE = new URL('.', import.meta.url).pathname;
const OUT = HERE + 'screenshots';
mkdirSync(OUT, { recursive: true });
const BASE = process.env.E2E_URL ?? 'http://localhost:4173/';
const CHROMIUM = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium';
const launchOpts = existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {};

import { readFileSync, writeFileSync } from 'node:fs';

const SC = OUT;
const errors = [];
const dialogs = [];

const browser = await chromium.launch(launchOpts);
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// --- Uncategorized quick filter (seed has uncategorized "Market Change" rows) ---
await page.getByText('Activity', { exact: true }).click();
await page.waitForTimeout(600);
const uncatChip = page.getByText(/❓ Uncategorized · \d+/);
if (await uncatChip.count() === 0) {
  errors.push('FLOW: uncategorized filter chip not shown');
} else {
  await uncatChip.first().click();
  await page.waitForTimeout(500);
  const marketRows = await page.getByText('Market Change').count();
  if (marketRows === 0) errors.push('FLOW: uncategorized filter did not surface uncategorized rows');
  await page.screenshot({ path: `${OUT}/17-uncategorized-filter.png` });
  await uncatChip.first().click();
  await page.waitForTimeout(300);
}

// --- Date chips in transaction form ---
await page.getByText('+ Add', { exact: true }).first().click();
await page.waitForTimeout(400);
await page.getByRole('dialog').getByText('Yesterday', { exact: true }).click();
await page.waitForTimeout(200);
const yest = new Date(); yest.setDate(yest.getDate() - 1);
const yIso = `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, '0')}-${String(yest.getDate()).padStart(2, '0')}`;
const dateVal = await page.locator(`input[value="${yIso}"]`).count();
if (dateVal === 0) errors.push('FLOW: Yesterday chip did not set date input');
await page.locator('text=✕').first().click();
await page.waitForTimeout(300);

// --- Move money validation: try moving $10,000 out of Dining Out ---
await page.getByText('Budget', { exact: true }).last().click();
await page.waitForTimeout(600);
await page.getByText('Move money').click();
await page.waitForTimeout(400);
const sheet = page.getByRole('dialog');
await sheet.getByText('🍜 Dining Out').first().click();   // "From" picker
await sheet.getByText('💪 Health & Fitness').last().click(); // "To" picker
await page.getByPlaceholder('50.00').fill('10000');
await page.getByText('Move', { exact: true }).last().click();
await page.waitForTimeout(400);
if (!dialogs.some((d) => d.includes('Not enough in envelope'))) {
  errors.push(`FLOW: move-money over-move not blocked, dialogs=${JSON.stringify(dialogs)}`);
}
// Valid small move should close the sheet
await page.getByPlaceholder('50.00').fill('5.00');
await page.getByText('Move', { exact: true }).last().click();
await page.waitForTimeout(400);

// --- Copy last month (August has no assignments yet) ---
await page.getByText('›').click();
await page.waitForTimeout(500);
await page.getByText('Copy last month').click();
await page.waitForTimeout(400);
const copiedNote = await page.getByText(/copied 8 envelopes from last month/).count();
if (copiedNote === 0) errors.push('FLOW: copy-last-month did not report copying 8 envelopes');
await page.screenshot({ path: `${OUT}/18-copy-last-month.png` });

// --- Auto-assign: August is fully copied (== targets), September is empty ---
await page.getByText('Auto-assign').click();
await page.waitForTimeout(400);
if ((await page.getByText(/all targets already funded/).count()) === 0) {
  errors.push('FLOW: auto-assign after copy should report targets already funded');
}
await page.getByText('›').click();
await page.waitForTimeout(500);
await page.getByText('Auto-assign').click();
await page.waitForTimeout(400);
if ((await page.getByText(/auto-assigned \$3,145\.00 across 8 envelopes/).count()) === 0) {
  errors.push('FLOW: auto-assign did not fund 8 envelopes in the empty month');
}
if ((await page.getByText(/▲ .* to target/).count()) !== 0) {
  errors.push('FLOW: target chips still show underfunded after auto-assign');
}
await page.screenshot({ path: `${OUT}/20-auto-assign.png` });
await page.getByText('‹').click();
await page.waitForTimeout(300);
await page.getByText('‹').click();
await page.waitForTimeout(400);

// --- Backup export (web download) ---
await page.getByText('More', { exact: true }).last().click();
await page.waitForTimeout(600);

// --- Debt payoff card (seeded Rewards Card has APR + min payment) ---
await page.getByText('Debt payoff', { exact: true }).scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
if ((await page.getByText('Debt-free', { exact: true }).count()) === 0) {
  errors.push('FLOW: debt payoff card missing Debt-free date');
}
if ((await page.getByText('Total interest').count()) === 0) {
  errors.push('FLOW: debt payoff card missing total interest');
}
await page.getByText(/Snowball · smallest first/).click();
await page.waitForTimeout(300);
if ((await page.getByText('Debt-free', { exact: true }).count()) === 0) {
  errors.push('FLOW: debt payoff card broke after strategy switch');
}
await page.screenshot({ path: `${OUT}/21-debt-payoff.png` });
const downloadPromise = page.waitForEvent('download');
await page.getByText('Export full backup (JSON)').click();
const download = await downloadPromise;
const backupPath = `${SC}/test-backup.json`;
await download.saveAs(backupPath);
const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
if (backup.app !== 'survive-budget' || !Array.isArray(backup.data.transactions)) {
  errors.push('FLOW: backup file malformed');
}

// --- Security section: web should say native-only ---
if ((await page.getByText('available in the Android and iOS apps').count()) === 0) {
  errors.push('FLOW: web security section message missing');
}
await page.getByText('Security', { exact: true }).scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/19-data-security.png` });

// --- Restore: clear all data, then restore the backup ---
await page.getByText('Clear all data').click();
await page.waitForTimeout(300);
await page.getByText('Yes, delete everything').click();
await page.waitForTimeout(600);
// After clear there should be no accounts
await page.getByText('Home', { exact: true }).last().click();
await page.waitForTimeout(400);
await page.getByText('More', { exact: true }).last().click();
await page.waitForTimeout(400);
const chooserPromise = page.waitForEvent('filechooser');
await page.getByText('Restore backup (JSON)').click();
await (await chooserPromise).setFiles(backupPath);
await page.waitForTimeout(600);
await page.getByText('Yes, restore backup').click();
await page.waitForTimeout(700);
if (!dialogs.some((d) => d.includes('Restore complete'))) {
  errors.push(`FLOW: restore did not complete, dialogs=${JSON.stringify(dialogs)}`);
}
if ((await page.getByText('Everyday Checking').count()) === 0) {
  errors.push('FLOW: restored data missing accounts');
}

// --- Bad backup file is rejected ---
const badPath = `${SC}/bad-backup.json`;
writeFileSync(badPath, JSON.stringify({ hello: 'world' }));
const chooser2Promise = page.waitForEvent('filechooser');
await page.getByText('Restore backup (JSON)').click();
await (await chooser2Promise).setFiles(badPath);
await page.waitForTimeout(600);
if (!dialogs.some((d) => d.includes('not a Survive Budget backup'))) {
  errors.push(`FLOW: invalid backup not rejected, dialogs=${JSON.stringify(dialogs)}`);
}

// --- Smoke every tab for console errors ---
for (const tab of ['Home', 'Budget', 'Activity', 'Reports', 'More']) {
  await page.getByText(tab, { exact: true }).last().click();
  await page.waitForTimeout(500);
}

console.log(JSON.stringify({ errors, dialogCount: dialogs.length }, null, 2));
await browser.close();
process.exit(errors.length ? 1 : 0);
