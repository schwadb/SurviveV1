// Minimal OFX/QFX statement parser. Banks export OFX 1.x (SGML, unclosed
// tags) or 2.x (XML); both wrap transactions in <STMTTRN> blocks with
// DTPOSTED / TRNAMT / NAME / MEMO fields, which is all we need.

export interface OfxTransaction {
  date: string; // yyyy-mm-dd
  payee: string;
  amount: number; // cents, sign as in file (debits negative)
  fitId?: string;
}

export interface OfxParseResult {
  rows: OfxTransaction[];
  errors: string[];
}

/** True if the text looks like an OFX/QFX statement rather than CSV. */
export function looksLikeOfx(text: string): boolean {
  const head = text.slice(0, 2000).toUpperCase();
  return head.includes('OFXHEADER') || head.includes('<OFX>') || head.includes('<STMTTRN>');
}

function field(block: string, tag: string): string | null {
  // SGML: value runs to next '<' or newline. XML: value ends at closing tag.
  const m = block.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i'));
  return m ? m[1].trim() : null;
}

function parseOfxDate(raw: string): string | null {
  // e.g. 20260701, 20260701120000, 20260701120000.000[-5:EST]
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${y}-${mo}-${d}`;
}

export function parseOfx(text: string): OfxParseResult {
  const rows: OfxTransaction[] = [];
  const errors: string[] = [];
  const blocks = text.match(/<STMTTRN>[\s\S]*?(?:<\/STMTTRN>|(?=<STMTTRN>)|$)/gi) ?? [];
  if (blocks.length === 0) {
    return { rows, errors: ['No <STMTTRN> transaction blocks found in this file.'] };
  }
  blocks.forEach((block, i) => {
    const rawDate = field(block, 'DTPOSTED');
    const rawAmount = field(block, 'TRNAMT');
    const name = field(block, 'NAME') ?? field(block, 'PAYEE') ?? field(block, 'MEMO');
    const date = rawDate ? parseOfxDate(rawDate) : null;
    const amountNum = rawAmount ? Number(rawAmount.replace(/[+$,\s]/g, '')) : NaN;
    if (!date) { errors.push(`Transaction ${i + 1}: missing/bad DTPOSTED`); return; }
    if (!Number.isFinite(amountNum)) { errors.push(`Transaction ${i + 1}: missing/bad TRNAMT`); return; }
    rows.push({
      date,
      payee: (name ?? 'Unknown').trim() || 'Unknown',
      amount: Math.round(amountNum * 100),
      fitId: field(block, 'FITID') ?? undefined,
    });
  });
  return { rows, errors };
}
