/** Format integer cents as a currency string, e.g. 123456 -> "$1,234.56". */
export function fmt(cents: number, opts: { sign?: boolean; compact?: boolean } = {}): string {
  const sign = cents < 0 ? '-' : opts.sign && cents > 0 ? '+' : '';
  const abs = Math.abs(cents);
  if (opts.compact && abs >= 1000000_00) {
    return `${sign}$${(abs / 1000000_00).toFixed(1)}M`;
  }
  if (opts.compact && abs >= 10000_00) {
    return `${sign}$${Math.round(abs / 1000_00)}k`;
  }
  const dollars = Math.floor(abs / 100);
  const cts = (abs % 100).toString().padStart(2, '0');
  return `${sign}$${dollars.toLocaleString('en-US')}.${cts}`;
}

/** Format without cents when whole, for compact chips. */
export function fmtShort(cents: number): string {
  if (Math.abs(cents) % 100 === 0) {
    const sign = cents < 0 ? '-' : '';
    return `${sign}$${Math.abs(Math.round(cents / 100)).toLocaleString('en-US')}`;
  }
  return fmt(cents);
}

/** Parse a user-entered amount string ("12.34", "$1,200") into cents. */
export function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, '');
  if (!cleaned || !/^-?\d*(\.\d{0,2})?$/.test(cleaned) || cleaned === '-' || cleaned === '.') {
    return null;
  }
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}
