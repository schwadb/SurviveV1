// Scale drive: load ~10k transactions via the testing button, then verify the
// app stays responsive — search filters, tabs navigate, Budget month nav works,
// with no console errors and no unbounded render blow-up.
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';

const HERE = new URL('.', import.meta.url).pathname;
const OUT = HERE + 'screenshots';
mkdirSync(OUT, { recursive: true });
const BASE = process.env.E2E_URL ?? 'http://localhost:4173/';
const CHROMIUM = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium';
const launchOpts = existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {};

const errors = [];
const browser = await chromium.launch(launchOpts);
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('dialog', async (d) => { await d.accept(); });

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// Load 10k synthetic transactions.
await page.getByText('More', { exact: true }).last().click();
await page.waitForTimeout(400);
await page.getByText('Load 10k demo transactions (testing)').scrollIntoViewIfNeeded();
await page.getByText('Load 10k demo transactions (testing)').click();
await page.waitForTimeout(1500);

// Budget screen must still compute (indexed) and navigate months quickly.
let start = Date.now();
await page.getByText('Budget', { exact: true }).last().click();
await page.waitForTimeout(600);
if ((await page.getByText('Ready to assign').count()) === 0) {
  errors.push('FLOW: Budget screen did not render with 10k transactions');
}
await page.getByText('›').click();
await page.waitForTimeout(400);
await page.getByText('‹').click();
await page.waitForTimeout(400);
const budgetMs = Date.now() - start;
if (budgetMs > 12000) errors.push(`PERF: Budget interactions took ${budgetMs}ms with 10k tx`);

// Activity: the virtualized list must render, and search must filter.
await page.getByText('Activity', { exact: true }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/23-scale-activity.png` });
start = Date.now();
await page.getByPlaceholder('Search payee, note, category…').fill('Cinema');
await page.waitForTimeout(700);
const searchMs = Date.now() - start;
if (searchMs > 8000) errors.push(`PERF: search with 10k tx took ${searchMs}ms`);
if ((await page.getByText(/Cinema/).count()) === 0) {
  errors.push('FLOW: search returned nothing on 10k dataset');
}
await page.getByPlaceholder('Search payee, note, category…').fill('');
await page.waitForTimeout(400);

// Every tab navigable without a crash.
for (const tab of ['Home', 'Reports', 'More', 'Home']) {
  await page.getByText(tab, { exact: true }).last().click();
  await page.waitForTimeout(600);
}

console.log(JSON.stringify({ errors, budgetMs, searchMs }, null, 2));
await browser.close();
process.exit(errors.length ? 1 : 0);
