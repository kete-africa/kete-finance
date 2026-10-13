import { money, multiply, sum } from '@kete/money';

export interface BoughtLine {
  label: string;
  quantity: number;
  unitPrice: number;
}

/** What a request asks for: each line rounded once, then added. */
export function amountOf(lines: readonly BoughtLine[], currency: string): number {
  return sum(
    lines.map((line) => multiply(money(line.unitPrice, currency), line.quantity)),
    currency,
  ).amount;
}
