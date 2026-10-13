import { formatMoney, money, parseMoney } from '@kete/money';
import { getLocale } from '@/paraglide/runtime.js';

/** An amount as a person reads it, in her language: « 2 480 000 F CFA ». */
export function shown(amount: number, currency: string): string {
  return formatMoney(money(amount, currency), { locale: getLocale() });
}

/** An amount as a person types it, read exactly; null when it is not one. */
export function typed(text: string, currency: string): number | null {
  if (text.trim() === '') return null;
  try {
    const amount = parseMoney(text, currency).amount;
    return amount >= 0 ? amount : null;
  } catch {
    return null;
  }
}

/** A quantity as a person types it — « 8 », « 2,5 » — or null. */
export function quantityOf(text: string): number | null {
  const value = Number(text.trim().replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : null;
}
