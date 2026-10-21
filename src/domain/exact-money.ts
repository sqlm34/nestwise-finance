// Keep exact decimal cents without passing BigInt to Android Intl.NumberFormat.
export function exactUsd(cents: bigint, locale: 'en' | 'ru'): string {
  const absolute = cents < 0n ? -cents : cents;
  const whole = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, locale === 'ru' ? '\u00a0' : ',');
  return `${cents < 0n ? '−' : ''}${whole}${locale === 'ru' ? ',' : '.'}${(absolute % 100n).toString().padStart(2, '0')} USD`;
}
