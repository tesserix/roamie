const ZERO = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'IDR', 'HUF', 'TWD', 'UGX', 'XAF', 'XOF']);
const THREE = new Set(['KWD', 'BHD', 'JOD', 'OMR', 'TND', 'LYD', 'IQD']);

export function decimals(currency: string): number {
  if (ZERO.has(currency)) return 0;
  if (THREE.has(currency)) return 3;
  return 2;
}

export function toMinor(input: string, currency: string): number | null {
  const clean = input.replace(/[\s,]/g, '');
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  return Math.round(Number(clean) * 10 ** decimals(currency));
}

export function format(minor: number, currency: string): string {
  const d = decimals(currency);
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(minor / 10 ** d);
}

// rates are "units of X per one unit of home", as returned by /v1/fx?base=home
export function toHome(minor: number, from: string, home: string, rates: Record<string, number>): number | null {
  if (from === home) return minor;
  const rate = rates[from];
  if (!rate) return null;
  const major = minor / 10 ** decimals(from) / rate;
  return Math.round(major * 10 ** decimals(home));
}

export const THRESHOLDS = [50, 80, 100] as const;

export function crossed(beforeMinor: number, afterMinor: number, budgetMinor: number): number | null {
  if (budgetMinor <= 0) return null;
  const pct = (v: number) => (v / budgetMinor) * 100;
  const hit = THRESHOLDS.filter((t) => pct(beforeMinor) < t && pct(afterMinor) >= t);
  return hit.length ? hit[hit.length - 1] : null;
}
