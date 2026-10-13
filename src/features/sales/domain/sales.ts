import { RuleError } from '@kete/capabilities';
import { money, percent } from '@kete/money';

// The rules of sales, pure: no database, no framework, tested alone. Every amount is an integer
// of the currency's smallest unit, computed here — never by a model, never by a screen.

/** A rule of sales a gesture broke: the screen words its code (`errors_<code>`). */
export class SalesRuleError extends RuleError {
  constructor(
    override readonly code:
      | 'quote_not_found'
      | 'quote_not_draft'
      | 'quote_not_open'
      | 'quote_not_won'
      | 'nothing_left_to_invoice'
      | 'invoice_not_found'
      | 'invoice_not_draft'
      | 'invoice_not_issued'
      | 'more_than_due',
  ) {
    super(code);
    this.name = 'SalesRuleError';
  }
}

export { budgetOf, totalsOf, type PricedLine, type Totals } from './totals';

export type QuoteStatus = 'draft' | 'sent' | 'won' | 'lost';
export type InvoiceStatus = 'draft' | 'issued';

export function sent(status: QuoteStatus): QuoteStatus {
  if (status !== 'draft') throw new SalesRuleError('quote_not_draft');
  return 'sent';
}

/** Won or lost: once, from a draft or a quote that was sent. */
export function closed(status: QuoteStatus, as: 'won' | 'lost'): QuoteStatus {
  if (status !== 'draft' && status !== 'sent') throw new SalesRuleError('quote_not_open');
  return as;
}

/**
 * The part of a quote an invoice takes: `share` percent of it, never more than what is left. The
 * invoice that takes the rest takes the rest of the tax too, so the invoices add up to the quote
 * to the unit.
 */
export function partOf(
  quote: { subtotal: number; tax: number; taxRate: number },
  invoiced: { subtotal: number; tax: number },
  share: number,
  currency: string,
): { subtotal: number; tax: number; total: number } {
  const left = quote.subtotal - invoiced.subtotal;
  if (left <= 0) throw new SalesRuleError('nothing_left_to_invoice');
  const asked = percent(money(quote.subtotal, currency), share).amount;
  const subtotal = Math.min(Math.max(asked, 1), left);
  const tax =
    subtotal === left
      ? quote.tax - invoiced.tax
      : percent(money(subtotal, currency), quote.taxRate).amount;
  return { subtotal, tax, total: subtotal + tax };
}

/** What stays due on an invoice once `amount` is received: never more than what is due. */
export function dueAfter(invoice: { total: number; received: number }, amount: number): number {
  const due = invoice.total - invoice.received;
  if (amount > due) throw new SalesRuleError('more_than_due');
  return due - amount;
}

/** How documents are numbered: quotes and invoices start again each year. */
export const NUMBERS = {
  quote: { series: 'quote', pattern: 'D-{YYYY}-{N:4}' },
  invoice: { series: 'invoice', pattern: 'F-{YYYY}-{N:4}' },
} as const;
