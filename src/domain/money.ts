/** Financial calculations use safe integer cents; conversion to Number is display only. */
export function cents(value: string): number {
  const raw = value.trim().replace(/^\$/, '');
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(raw)) throw new Error('invalidAmount');
  const negative = raw.startsWith('-');
  const [whole, fraction = ''] = raw.replace('-', '').replaceAll(',', '').split('.');
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('invalidAmount');
  return Number(negative ? -result : result);
}

export function sumCents(values: readonly number[]): number {
  let result = 0n;
  for (const value of values) {
    if (!Number.isSafeInteger(value)) throw new Error('invalidAmount');
    result += BigInt(value);
  }
  if (result > BigInt(Number.MAX_SAFE_INTEGER) || result < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error('invalidAmount');
  return Number(result);
}

export function formatMoney(value: number, locale: 'en' | 'ru') {
  if (!Number.isSafeInteger(value)) throw new Error('invalidAmount');
  return new Intl.NumberFormat(locale === 'ru' ? 'ru-RU' : 'en-US', { style: 'currency', currency: 'USD' }).format(value / 100);
}
