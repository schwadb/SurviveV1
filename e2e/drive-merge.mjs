// Household merge drive: add a transaction, back it up, delete it, then merge
// the backup to re-add it (proving merge ADDS), merge again (idempotent no-op),
// and repeat through an ENCRYPTED backup file. Covers plain + encrypted paths.
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';

const HERE = new URL('.', import.meta.url).pathname;
const OUT = HERE + 'screenshots';
mkdirSync(OUT, { recursive: true });
const BASE = process.env.E2E_URL ?? 'http://localhost:4173/';
const CHROMIUM = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium';
const launchOpts = existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {};

const errors = [];
const dialogs = [];
const browser = await chromium.launch(launchOpts);
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const search = page.getByPlaceholder('Search payee, note, category…');

async function addSoloPurchase() {
  await page.getByText('Activity', { exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByText('+ Add', { exact: true }).first().click();
  await page.waitForTimeout(400);
  await page.getByPlaceholder('Fresh Market').fill('Solo Purchase');
  await page.getByPlaceholder('12.34').fill('12.00');
  await page.getByText('🎉 Fun Money').last().click();
  await page.getByText('Add Transaction', { exact: true }).last().click();
  await page.waitForTimeout(500);
}

async function deleteSoloPurchase() {
  await page.getByText('Activity', { exact: true }).click();
  await page.waitForTimeout(300);
  await search.fill('Solo Purchase');
  await page.waitForTimeout(400);
  await page.getByText('Solo Purchase').first().click();
  await page.waitForTimeout(400);
  await page.getByText('Delete', { exact: true }).last().click();
  await page.waitForTimeout(400);
  await search.fill('Solo Purchase');
  await page.waitForTimeout(400);
  if ((await page.getByText('Solo Purchase').count()) !== 0) errors.push('FLOW: delete did not remove Solo Purchase');
  await search.fill('');
}

async function soloVisible() {
  await page.getByText('Activity', { exact: true }).click();
  await page.waitForTimeout(300);
  await search.fill('Solo Purchase');
  await page.waitForTimeout(400);
  const n = await page.getByText('Solo Purchase').count();
  await search.fill('');
  return n;
}

// --- Plain backup round trip ---
await addSoloPurchase();
await page.getByText('More', { exact: true }).last().click();
await page.waitForTimeout(400);
const dl = page.waitForEvent('download');
await page.getByText('Export full backup (JSON)').click();
const plainPath = `${OUT}/merge-plain.json`;
await (await dl).saveAs(plainPath);

await deleteSoloPurchase();

// Merge the backup → Solo Purchase must be re-added (merge ADDS).
await page.getByText('More', { exact: true }).last().click();
await page.waitForTimeout(400);
let chooser = page.waitForEvent('filechooser');
await page.getByText('Merge backup (household)').click();
await (await chooser).setFiles(plainPath);
await page.waitForTimeout(600);
if ((await page.getByText(/Add 1 transaction/).count()) === 0) {
  errors.push('FLOW: merge preview did not offer to add the deleted transaction');
}
await page.getByText('Merge', { exact: true }).click();
await page.waitForTimeout(500);
if (!dialogs.some((d) => d.includes('Added 1 transaction'))) {
  errors.push(`FLOW: merge did not add 1, dialogs=${JSON.stringify(dialogs.slice(-1))}`);
}
if ((await soloVisible()) === 0) errors.push('FLOW: Solo Purchase not restored by merge');
await page.screenshot({ path: `${OUT}/26-merge.png` });

// Merge the SAME file again → idempotent no-op (all duplicates).
await page.getByText('More', { exact: true }).last().click();
await page.waitForTimeout(400);
chooser = page.waitForEvent('filechooser');
await page.getByText('Merge backup (household)').click();
await (await chooser).setFiles(plainPath);
await page.waitForTimeout(600);
await page.getByText('Merge', { exact: true }).click();
await page.waitForTimeout(500);
if (!dialogs.some((d) => d.includes('Added 0 transactions'))) {
  errors.push(`FLOW: second merge was not a no-op, dialogs=${JSON.stringify(dialogs.slice(-1))}`);
}
if ((await soloVisible()) !== 1) errors.push('FLOW: idempotent merge duplicated Solo Purchase');

// --- Encrypted backup round trip ---
await page.getByText('More', { exact: true }).last().click();
await page.waitForTimeout(400);
const encDl = page.waitForEvent('download');
await page.getByText('Export encrypted backup (AES-256)').click();
await page.waitForTimeout(400);
const passInputs = page.getByRole('dialog').locator('input:not([type="checkbox"])');
await passInputs.nth(0).fill('household-secret');
await passInputs.nth(1).fill('household-secret');
await page.getByText('Encrypt & Export').click();
const encPath = `${OUT}/merge-enc.enc.json`;
await (await encDl).saveAs(encPath);
await page.waitForTimeout(400);

await deleteSoloPurchase();

await page.getByText('More', { exact: true }).last().click();
await page.waitForTimeout(400);
chooser = page.waitForEvent('filechooser');
await page.getByText('Merge backup (household)').click();
await (await chooser).setFiles(encPath);
await page.waitForTimeout(600);
// Passphrase prompt for the encrypted merge file.
await page.getByRole('dialog').locator('input:not([type="checkbox"])').first().fill('household-secret');
await page.getByText('Unlock', { exact: true }).click();
await page.waitForTimeout(800);
if ((await page.getByText(/Add 1 transaction/).count()) === 0) {
  errors.push('FLOW: encrypted merge preview did not offer the deleted transaction');
}
await page.getByText('Merge', { exact: true }).click();
await page.waitForTimeout(500);
if ((await soloVisible()) === 0) errors.push('FLOW: encrypted merge did not restore Solo Purchase');

console.log(JSON.stringify({ errors, dialogCount: dialogs.length }, null, 2));
await browser.close();
process.exit(errors.length ? 1 : 0);
