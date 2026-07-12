// Drive the exported web app: visit every tab, exercise key flows,
// capture console errors and screenshots.
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';

const HERE = new URL('.', import.meta.url).pathname;
const OUT = HERE + 'screenshots';
mkdirSync(OUT, { recursive: true });
const BASE = process.env.E2E_URL ?? 'http://localhost:4173/';
const CHROMIUM = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium';
const launchOpts = existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {};


const SHOTS = OUT;
const errors = [];

const browser = await chromium.launch(launchOpts);
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const shot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png` });

// --- Home ---
await shot('01-home');

// --- Budget tab ---
await page.getByText('Budget', { exact: true }).last().click();
await page.waitForTimeout(600);
await shot('02-budget');

// Assign money to an envelope
await page.getByText('🛒 Groceries').first().click();
await page.waitForTimeout(500);
const assignInput = page.locator('input:not([type="checkbox"])').first();
await assignInput.fill('600.00');
await page.getByText('Save', { exact: true }).click();
await page.waitForTimeout(500);
await shot('03-budget-after-assign');

// Move money sheet
await page.getByText('Move money').click();
await page.waitForTimeout(400);
await shot('04-move-money');
await page.locator('text=✕').first().click();
await page.waitForTimeout(300);

// --- Transactions tab ---
await page.getByText('Activity', { exact: true }).click();
await page.waitForTimeout(600);
await shot('05-transactions');

// Add a transaction
await page.getByText('+ Add', { exact: true }).first().click();
await page.waitForTimeout(400);
await page.getByPlaceholder('Fresh Market').fill('Test Bookstore');
await page.getByPlaceholder('12.34').fill('19.99');
await page.getByText('🎉 Fun Money').last().click();
await page.getByText('Add Transaction', { exact: true }).last().click();
await page.waitForTimeout(600);
// search for it
await page.getByPlaceholder('Search payee, note, category…').fill('bookstore');
await page.waitForTimeout(400);
await shot('06-transaction-added-search');
const found = await page.getByText('Test Bookstore').count();
if (found === 0) errors.push('FLOW: added transaction not found via search');
await page.getByPlaceholder('Search payee, note, category…').fill('');

// --- Reports tab ---
await page.getByText('Reports', { exact: true }).last().click();
await page.waitForTimeout(800);
await shot('07-reports');
await page.getByText('Net worth trend').scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await shot('08-reports-scrolled');

// --- More tab ---
await page.getByText('More', { exact: true }).last().click();
await page.waitForTimeout(600);
await shot('09-more');

// Mark a bill paid if one is unpaid
const markPaid = page.getByText('Mark paid');
if (await markPaid.count() > 0) {
  await markPaid.first().click();
  await page.waitForTimeout(500);
  await shot('10-bill-paid');
}

// Contribute to a goal
await page.getByText('🗾 Japan Trip').click();
await page.waitForTimeout(400);
await page.getByRole('dialog').locator('input:not([type="checkbox"])').first().fill('50');
await page.getByText('Add to Goal').click();
await page.waitForTimeout(500);

// Dark mode
await page.getByText('Dark', { exact: true }).click();
await page.waitForTimeout(500);
await page.mouse.wheel(0, -3000);
await page.waitForTimeout(300);
await shot('11-more-dark');
await page.getByText('Home', { exact: true }).last().click();
await page.waitForTimeout(600);
await shot('12-home-dark');
await page.getByText('Reports', { exact: true }).last().click();
await page.waitForTimeout(700);
await shot('13-reports-dark');

// Back to light for persistence check
await page.getByText('More', { exact: true }).last().click();
await page.waitForTimeout(400);
await page.getByText('Light', { exact: true }).click();
await page.waitForTimeout(300);

// Reload: verify persistence (added tx should survive)
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.getByText('Activity', { exact: true }).click();
await page.waitForTimeout(600);
await page.getByPlaceholder('Search payee, note, category…').fill('bookstore');
await page.waitForTimeout(400);
const persisted = await page.getByText('Test Bookstore').count();
if (persisted === 0) errors.push('FLOW: transaction did not persist across reload');

console.log(JSON.stringify({ errors }, null, 2));
await browser.close();
process.exit(errors.length ? 1 : 0);
