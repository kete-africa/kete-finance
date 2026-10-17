import { defineCommand } from '@kete/commands';
import { currencyIn, today } from '@/features/register';
import { actingFor } from '@/platform/person';
import { kindOfMethod, TreasuryRuleError } from '../domain/treasury';
import {
  assignMovement as assign,
  balanceOn,
  findAccount,
  findMovement,
  insertAccount,
  insertClosing,
  insertMovement,
  taking,
} from '../infrastructure/treasury.table';
import {
  accountInput,
  assignInput,
  closingInput,
  methodOf,
  movementInput,
  transferInput,
} from '../treasury.record';

/** Opens an account here: a bank account, a till, a mobile wallet, with what it holds that day. */
export const openAccount = defineCommand({
  name: 'open-account',
  input: accountInput,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId, actor }) {
    const accountId = await insertAccount(db, {
      organizationId,
      ...input,
      currency: await currencyIn(db, organizationId),
      createdBy: actingFor(actor),
    });
    return { accountId };
  },
  summarize: (input) => `Account "${input.name}" opened`,
});

/** Records money that moved outside sales and purchases: bank fees, the owner's contribution. */
export const recordMovement = defineCommand({
  name: 'record-movement',
  input: movementInput,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId, actor }) {
    const account = await taking(db, input.accountId, input);
    const movementId = await insertMovement(db, organizationId, {
      accountId: account.accountId,
      direction: input.direction,
      amount: input.amount,
      on: input.on,
      method: methodOf(account.kind),
      label: input.label,
      source: null,
      recordedBy: actingFor(actor),
    });
    return { movementId };
  },
  summarize: (input) => `Movement recorded on account ${input.accountId}`,
});

/** Carries money from one account to another: out of one, into the other, the same day. */
export const transferMoney = defineCommand({
  name: 'transfer-money',
  input: transferInput,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId, actor }) {
    if (input.fromAccountId === input.toAccountId) throw new TreasuryRuleError('same_account');
    const from = await taking(db, input.fromAccountId, { ...input, direction: 'out' });
    const to = await taking(db, input.toAccountId, { ...input, direction: 'in' });
    const transfer = crypto.randomUUID();
    const label = input.label ?? `${from.name} → ${to.name}`;
    const recordedBy = actingFor(actor);
    for (const [account, direction] of [
      [from, 'out'],
      [to, 'in'],
    ] as const) {
      await insertMovement(db, organizationId, {
        accountId: account.accountId,
        direction,
        amount: input.amount,
        on: input.on,
        method: methodOf(account.kind),
        label,
        source: `transfer:${transfer}:${direction}`,
        recordedBy,
      });
    }
    return { transfer };
  },
  summarize: (input) => `Money carried from ${input.fromAccountId} to ${input.toAccountId}`,
});

/** Gives its account to a movement that waited for one: of the kind its way of paying goes to. */
export const assignMovement = defineCommand({
  name: 'assign-movement',
  input: assignInput,
  reversibility: { reversible: false },
  async handler({ movementId, accountId }, { db }) {
    const movement = await findMovement(db, movementId);
    if (!movement) throw new TreasuryRuleError('movement_not_found');
    if (movement.accountId) throw new TreasuryRuleError('movement_assigned');
    const account = await taking(db, accountId, movement);
    if (account.kind !== kindOfMethod(movement.method)) {
      throw new TreasuryRuleError('account_not_found');
    }
    await assign(db, movementId, accountId);
    return { movementId, accountId };
  },
  summarize: ({ movementId }) => `Movement ${movementId} assigned`,
});

/**
 * Closes a till for a day: what the movements say it holds, what was counted in the drawer, and
 * the difference — written as it is, never adjusted. From then on the till takes nothing dated
 * that day or before.
 */
export const closeTill = defineCommand({
  name: 'close-till',
  input: closingInput,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId, actor }) {
    const account = await findAccount(db, input.accountId);
    if (!account) throw new TreasuryRuleError('account_not_found');
    if (account.kind !== 'till') throw new TreasuryRuleError('not_a_till');
    if (!account.active) throw new TreasuryRuleError('account_closed');
    if (input.closedOn > today()) throw new TreasuryRuleError('day_not_over');
    if (account.closedOn && input.closedOn <= account.closedOn) {
      throw new TreasuryRuleError('already_closed');
    }
    const expected = await balanceOn(db, account.accountId, input.closedOn);
    const closingId = await insertClosing(db, {
      organizationId,
      accountId: account.accountId,
      closedOn: input.closedOn,
      expected,
      counted: input.counted,
      note: input.note,
      closedBy: actingFor(actor),
    });
    return { closingId, expected, difference: input.counted - expected };
  },
  summarize: ({ accountId, closedOn }) => `Till ${accountId} closed for ${closedOn}`,
});
