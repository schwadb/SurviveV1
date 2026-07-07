import { describe, expect, it } from 'vitest';
import { looksLikeOfx, parseOfx } from '../ofx';

const SGML = `OFXHEADER:100
DATA:OFXSGML
<OFX>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260702120000.000[-5:EST]
<TRNAMT>-42.18
<FITID>001
<NAME>WHOLEFDS MKT 10234
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260701
<TRNAMT>250.00
<FITID>002
<NAME>REFUND ACME
</STMTTRN>
</OFX>`;

const XMLISH = `<?xml version="1.0"?><OFX><STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260703</DTPOSTED><TRNAMT>-15.99</TRNAMT><NAME>NETFLIX.COM</NAME></STMTTRN></OFX>`;

describe('looksLikeOfx', () => {
  it('detects OFX/QFX headers and blocks', () => {
    expect(looksLikeOfx(SGML)).toBe(true);
    expect(looksLikeOfx(XMLISH)).toBe(true);
    expect(looksLikeOfx('date,payee,amount\n2026-07-01,A,-1')).toBe(false);
  });
});

describe('parseOfx', () => {
  it('parses SGML (unclosed tags) with timezone-suffixed dates', () => {
    const { rows, errors } = parseOfx(SGML);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      date: '2026-07-02', payee: 'WHOLEFDS MKT 10234', amount: -4218, fitId: '001',
    });
    expect(rows[1]).toMatchObject({ date: '2026-07-01', amount: 25000 });
  });

  it('parses XML-style closed tags', () => {
    const { rows, errors } = parseOfx(XMLISH);
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ date: '2026-07-03', payee: 'NETFLIX.COM', amount: -1599 });
  });

  it('rejects invalid months and missing amounts per-row', () => {
    const bad = '<STMTTRN><DTPOSTED>20261301<TRNAMT>-1.00<NAME>X</STMTTRN>' +
      '<STMTTRN><DTPOSTED>20260701<NAME>NoAmount</STMTTRN>' +
      '<STMTTRN><DTPOSTED>20260701<TRNAMT>-2.00<NAME>OK</STMTTRN>';
    const { rows, errors } = parseOfx(bad);
    expect(rows).toHaveLength(1);
    expect(rows[0].payee).toBe('OK');
    expect(errors).toHaveLength(2);
  });

  it('errors on input with no transaction blocks', () => {
    const { rows, errors } = parseOfx('<OFX>nothing here</OFX>');
    expect(rows).toEqual([]);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('falls back to MEMO when NAME is absent', () => {
    const { rows } = parseOfx('<STMTTRN><DTPOSTED>20260701<TRNAMT>-1.00<MEMO>Memo Payee</STMTTRN>');
    expect(rows[0].payee).toBe('Memo Payee');
  });
});
