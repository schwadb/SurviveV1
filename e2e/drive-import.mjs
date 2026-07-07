// Verify statement import: QFX file picker flow, duplicate skipping on
// re-import, and CSV file import with rule-based auto-categorization.
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';

const HERE = new URL('.', import.meta.url).pathname;
const OUT = HERE + 'screenshots';
mkdirSync(OUT, { recursive: true });
const BASE = process.env.E2E_URL ?? 'http://localhost:4173/';
const CHROMIUM = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium';
const launchOpts = existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {};


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

const openImport = async () => {
  await page.getByText('More', { exact: true }).last().click();
  await page.waitForTimeout(500);
  await page.getByText('Import statement (CSV / OFX / QFX)').click();
  await page.waitForTimeout(500);
};

// --- Import QFX via file picker ---
await openImport();
const chooserPromise = page.waitForEvent('filechooser');
await page.getByText('📁 Choose statement file…').click();
const chooser = await chooserPromise;
await chooser.setFiles(`${HERE}fixtures/sample-statement.qfx`);
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/14-import-qfx.png` });

const readyText = await page.getByText(/OFX detected/).count();
if (readyText === 0) errors.push('FLOW: OFX not detected after file pick');
await page.getByText('Import', { exact: true }).last().click();
await page.waitForTimeout(700);
if (!dialogs.some((d) => d.includes('Imported 3'))) {
  errors.push(`FLOW: expected "Imported 3", dialogs=${JSON.stringify(dialogs)}`);
}

// Verify rows landed in Activity
await page.getByText('Activity', { exact: true }).click();
await page.waitForTimeout(500);
await page.getByPlaceholder('Search payee, note, category…').fill('NETFLIX');
await page.waitForTimeout(400);
if ((await page.getByText('NETFLIX.COM').count()) === 0) errors.push('FLOW: imported QFX row not in Activity');
await page.screenshot({ path: `${OUT}/15-imported-activity.png` });
await page.getByPlaceholder('Search payee, note, category…').fill('');

// --- Re-import same QFX: everything should be a duplicate ---
dialogs.length = 0;
await openImport();
const chooser2Promise = page.waitForEvent('filechooser');
await page.getByText('📁 Choose statement file…').click();
await (await chooser2Promise).setFiles(`${HERE}fixtures/sample-statement.qfx`);
await page.waitForTimeout(800);
await page.getByText('Import', { exact: true }).last().click();
await page.waitForTimeout(700);
if (!dialogs.some((d) => d.includes('Imported 0') && d.includes('skipped 3 duplicates'))) {
  errors.push(`FLOW: dedupe failed, dialogs=${JSON.stringify(dialogs)}`);
}

// --- CSV file import; "SHELL OIL" should auto-categorize via the "shell" rule ---
dialogs.length = 0;
await openImport();
const chooser3Promise = page.waitForEvent('filechooser');
await page.getByText('📁 Choose statement file…').click();
await (await chooser3Promise).setFiles(`${HERE}fixtures/sample-statement.csv`);
await page.waitForTimeout(800);
await page.getByText('Import', { exact: true }).last().click();
await page.waitForTimeout(700);
// WHOLEFDS row is a duplicate of the QFX import; SHELL is new.
if (!dialogs.some((d) => d.includes('Imported 1') && d.includes('skipped 1 duplicate'))) {
  errors.push(`FLOW: CSV import counts wrong, dialogs=${JSON.stringify(dialogs)}`);
}
await page.getByText('Activity', { exact: true }).click();
await page.waitForTimeout(500);
await page.getByPlaceholder('Search payee, note, category…').fill('SHELL OIL');
await page.waitForTimeout(400);
if ((await page.getByText('⛽ Transport').count()) === 0) {
  errors.push('FLOW: imported SHELL row not auto-categorized to Transport by rule');
}
await page.screenshot({ path: `${OUT}/16-imported-rule-categorized.png` });

console.log(JSON.stringify({ errors, dialogs }, null, 2));
await browser.close();
process.exit(errors.length ? 1 : 0);
