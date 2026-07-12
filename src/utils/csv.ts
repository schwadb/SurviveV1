import { AppData, Transaction } from '../types';

function esc(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Export all transactions as CSV (date, payee, category, account, amount, note). */
export function transactionsToCsv(data: AppData): string {
  const catName = (id: string | null) =>
    data.categories.find((c) => c.id === id)?.name ?? '';
  const acctName = (id: string) => data.accounts.find((a) => a.id === id)?.name ?? '';
  const lines = ['date,payee,category,account,amount,note'];
  const sorted = [...data.transactions].sort((a, b) => a.date.localeCompare(b.date));
  for (const t of sorted) {
    if (t.splits && t.splits.length > 0) {
      // One row per leg so category totals reconcile; leg amounts sum to the parent.
      t.splits.forEach((leg, i) => {
        lines.push(
          [
            t.date, esc(t.payee), esc(catName(leg.categoryId)), esc(acctName(t.accountId)),
            (leg.amount / 100).toFixed(2), esc(`split ${i + 1}/${t.splits!.length}${t.note ? ` · ${t.note}` : ''}`),
          ].join(','),
        );
      });
      continue;
    }
    lines.push(
      [
        t.date, esc(t.payee), esc(catName(t.categoryId)), esc(acctName(t.accountId)),
        (t.amount / 100).toFixed(2), esc(t.note ?? ''),
      ].join(','),
    );
  }
  return lines.join('\n');
}

/** Split a CSV line respecting quotes. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export interface CsvParseResult {
  rows: { date: string; payee: string; amount: number; categoryName?: string }[];
  errors: string[];
}

/**
 * Parse pasted CSV with a header containing date/payee/amount columns
 * (category optional). Amounts in dollars; negative = spending.
 */
export function parseTransactionsCsv(text: string): CsvParseResult {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const errors: string[] = [];
  if (lines.length < 2) return { rows: [], errors: ['Need a header row plus at least one data row.'] };
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const di = header.findIndex((h) => h.includes('date'));
  const pi = header.findIndex((h) => h.includes('payee') || h.includes('description') || h.includes('merchant'));
  const ai = header.findIndex((h) => h.includes('amount'));
  const ci = header.findIndex((h) => h.includes('category'));
  if (di < 0 || pi < 0 || ai < 0) {
    return { rows: [], errors: ['Header must include date, payee/description, and amount columns.'] };
  }
  const rows: CsvParseResult['rows'] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const rawDate = (cols[di] ?? '').trim();
    const payee = (cols[pi] ?? '').trim();
    const amountNum = Number((cols[ai] ?? '').replace(/[$,\s]/g, ''));
    const date = normalizeDate(rawDate);
    if (!date) { errors.push(`Row ${i + 1}: bad date "${rawDate}"`); continue; }
    if (!payee) { errors.push(`Row ${i + 1}: missing payee`); continue; }
    if (!Number.isFinite(amountNum)) { errors.push(`Row ${i + 1}: bad amount`); continue; }
    rows.push({
      date, payee, amount: Math.round(amountNum * 100),
      categoryName: ci >= 0 ? (cols[ci] ?? '').trim() || undefined : undefined,
    });
  }
  return { rows, errors };
}

function normalizeDate(raw: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const mdY = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdY) {
    const [, m, d, y] = mdY;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}
