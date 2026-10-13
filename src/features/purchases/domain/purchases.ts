import { RuleError } from '@kete/capabilities';

// The rules of purchases and expenses, pure: no database, no framework, tested alone. Every
// amount is an integer of the currency's smallest unit.

/** A rule of purchases a gesture broke: the screen words its code (`errors_<code>`). */
export class PurchaseRuleError extends RuleError {
  constructor(
    override readonly code:
      | 'request_not_found'
      | 'request_not_waiting'
      | 'request_not_returned'
      | 'request_not_approved'
      | 'request_not_payable'
      | 'decided_at_the_center'
      | 'own_request'
      | 'not_the_requester'
      | 'reason_required'
      | 'post_required'
      | 'not_of_project'
      | 'supplier_required'
      | 'more_than_owed'
      | 'advance_not_found'
      | 'advance_closed'
      | 'not_the_holder'
      | 'more_than_advance',
  ) {
    super(code);
    this.name = 'PurchaseRuleError';
  }
}

export type RequestKind = 'purchase' | 'expense';
export type RequestStatus =
  | 'asked'
  | 'returned'
  | 'approved'
  | 'refused'
  | 'ordered'
  | 'paid'
  | 'cancelled';
/** Who decides: not known yet, the center's circuits, or this app's own rule. */
export type Route = 'waiting' | 'center' | 'here';

export { amountOf, type BoughtLine } from './amount';

/**
 * Where a request stands against its post: what the post still has once everything engaged on it
 * is taken off — committed, spent, and what is asked and waits — and by how much the request goes
 * beyond. A post the budget does not have has nothing: the whole request is beyond.
 */
export function standingOf(
  budget: number | null,
  engaged: number,
  amount: number,
): { budget: number; left: number; beyondBy: number } {
  const planned = budget ?? 0;
  const left = planned - engaged;
  return { budget: planned, left, beyondBy: Math.max(0, amount - Math.max(left, 0)) };
}

/**
 * The subject the center's circuits decide: beyond its post, a request takes the circuit of what
 * goes beyond the budget — the one that goes up — whatever it buys.
 */
export function subjectOf(kind: RequestKind, beyondBy: number): Subject {
  return beyondBy > 0 ? 'beyond_budget' : kind;
}
export type Subject = 'purchase' | 'expense' | 'beyond_budget';

/** The circuit to fall back on when the organization has none for what goes beyond the budget. */
export const plainSubject = (kind: RequestKind): Subject => kind;

/** What is still owed on a request once `amount` is paid: never more than what is owed. */
export function owedAfter(request: { amount: number; paid: number }, amount: number): number {
  const owed = request.amount - request.paid;
  if (amount > owed) throw new PurchaseRuleError('more_than_owed');
  return owed - amount;
}

/** What a holder still has to justify or bring back. */
export function outstandingOf(advance: {
  amount: number;
  justified: number;
  returned: number;
}): number {
  return advance.amount - advance.justified - advance.returned;
}

/** How the documents of purchases are numbered: each starts again every year. */
export const PURCHASE_NUMBERS = {
  purchase: { series: 'purchase_request', pattern: 'DA-{YYYY}-{N:4}' },
  expense: { series: 'expense_note', pattern: 'NF-{YYYY}-{N:4}' },
  order: { series: 'purchase_order', pattern: 'BC-{YYYY}-{N:4}' },
  advance: { series: 'advance', pattern: 'AV-{YYYY}-{N:4}' },
} as const;
