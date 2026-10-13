import * as m from '@/paraglide/messages.js';
import type { AccountKind } from '../domain/kinds';

/** A kind of account in words. */
export const kindLabel = (kind: AccountKind): string =>
  ({ bank: m.account_bank, till: m.account_till, mobile: m.account_mobile })[kind]();
