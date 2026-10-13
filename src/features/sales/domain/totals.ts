import { add, money, multiply, percent, subtract, sum } from '@kete/money';

// The arithmetic of a document, pure and light: the server computes with it, and a form shows the
// same figures while a person types. Every amount is an integer of the currency's smallest unit.

export interface PricedLine {
  label: string;
  quantity: number;
  /** What the client pays for one, before tax. */
  unitPrice: number;
  /** What it costs us for one: the margin and the project's budget come from it. */
  unitCost: number;
  /** The post of the project's budget its cost counts against: « Matériel ». */
  post: string;
}

export interface Totals {
  subtotal: number;
  tax: number;
  total: number;
  cost: number;
  /** Before tax: what is sold less what it costs. */
  margin: number;
}

/** A document's totals from its lines: each line rounded once, the tax once on the subtotal. */
export function totalsOf(
  lines: readonly Pick<PricedLine, 'quantity' | 'unitPrice' | 'unitCost'>[],
  taxRate: number,
  currency: string,
): Totals {
  const subtotal = sum(
    lines.map((line) => multiply(money(line.unitPrice, currency), line.quantity)),
    currency,
  );
  const cost = sum(
    lines.map((line) => multiply(money(line.unitCost, currency), line.quantity)),
    currency,
  );
  const tax = percent(subtotal, taxRate);
  return {
    subtotal: subtotal.amount,
    tax: tax.amount,
    total: add(subtotal, tax).amount,
    cost: cost.amount,
    margin: subtract(subtotal, cost).amount,
  };
}

/**
 * The budget a won quote gives its project: what each post is expected to cost. Two lines on one
 * post add up; a line that costs nothing opens no post.
 */
export function budgetOf(
  lines: readonly PricedLine[],
  currency: string,
): { name: string; budget: number }[] {
  const posts = new Map<string, number>();
  for (const line of lines) {
    const cost = multiply(money(line.unitCost, currency), line.quantity).amount;
    if (cost > 0) posts.set(line.post, (posts.get(line.post) ?? 0) + cost);
  }
  return [...posts].map(([name, budget]) => ({ name, budget }));
}
