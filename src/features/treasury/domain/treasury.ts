import { RuleError } from '@kete/capabilities';
import type { AccountKind } from './kinds';

export { reallyAvailable, type MoneyStanding, type ProjectFunds } from './standing';

// The rules of treasury, pure: no database, no framework, tested alone.

/** A rule of treasury a gesture broke: the screen words its code (`errors_<code>`). */
export class TreasuryRuleError extends RuleError {
  constructor(
    override readonly code:
      | 'account_not_found'
      | 'account_closed'
      | 'not_a_till'
      | 'till_closed'
      | 'already_closed'
      | 'not_enough_in_account'
      | 'same_account'
      | 'movement_not_found'
      | 'movement_assigned'
      | 'day_not_over',
  ) {
    super(code);
    this.name = 'TreasuryRuleError';
  }
}

export { accountKinds, kindOfMethod, type AccountKind, type Method } from './kinds';

/**
 * A till and a mobile wallet hold what they hold: nothing leaves that is not there. A bank
 * account may be overdrawn — the bank decides that, not this app.
 */
export function leaving(kind: AccountKind, balance: number, amount: number): void {
  if (kind !== 'bank' && amount > balance) throw new TreasuryRuleError('not_enough_in_account');
}
