import * as m from '@/paraglide/messages.js';

/**
 * A gesture's code in words (`RuleError`, a refusal): what happened, why, what to do. A code
 * without its own words is said in general terms, never as a code.
 */
export function sayError(code: string): string {
  const words: Record<string, () => string> = {
    not_allowed: m.errors_not_allowed,
    invalid_input: m.errors_invalid_input,
    not_found: m.errors_not_found,
    quote_not_found: m.errors_quote_not_found,
    quote_not_draft: m.errors_quote_not_draft,
    quote_not_open: m.errors_quote_not_open,
    quote_not_won: m.errors_quote_not_won,
    nothing_left_to_invoice: m.errors_nothing_left_to_invoice,
    invoice_not_found: m.errors_invoice_not_found,
    invoice_not_draft: m.errors_invoice_not_draft,
    invoice_not_issued: m.errors_invoice_not_issued,
    more_than_due: m.errors_more_than_due,
  };
  return (words[code] ?? m.errors_generic)();
}
