import * as m from '@/paraglide/messages.js';

/**
 * A gesture's code in words (`RuleError`, a refusal): what happened, why, what to do. A code
 * without its own words is said in general terms, never as a code.
 */
export function sayError(code: string, facts: Record<string, string | number> = {}): string {
  const words: Record<string, () => string> = {
    refused_by_agreement: () =>
      m.errors_refused_by_agreement({
        agreement: String(facts['agreement'] ?? ''),
        clause: String(facts['clause'] ?? ''),
      }),
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
    request_not_found: m.errors_request_not_found,
    request_not_waiting: m.errors_request_not_waiting,
    request_not_returned: m.errors_request_not_returned,
    request_not_approved: m.errors_request_not_approved,
    request_not_payable: m.errors_request_not_payable,
    decided_at_the_center: m.errors_decided_at_the_center,
    own_request: m.errors_own_request,
    not_the_requester: m.errors_not_the_requester,
    reason_required: m.errors_reason_required,
    post_required: m.errors_post_required,
    not_of_project: m.errors_not_of_project,
    supplier_required: m.errors_supplier_required,
    more_than_owed: m.errors_more_than_owed,
    advance_not_found: m.errors_advance_not_found,
    advance_closed: m.errors_advance_closed,
    not_the_holder: m.errors_not_the_holder,
    more_than_advance: m.errors_more_than_advance,
    account_not_found: m.errors_account_not_found,
    account_closed: m.errors_account_closed,
    not_a_till: m.errors_not_a_till,
    till_closed: m.errors_till_closed,
    already_closed: m.errors_already_closed,
    not_enough_in_account: m.errors_not_enough_in_account,
    same_account: m.errors_same_account,
    movement_not_found: m.errors_movement_not_found,
    movement_assigned: m.errors_movement_assigned,
    day_not_over: m.errors_day_not_over,
  };
  return (words[code] ?? m.errors_generic)();
}
