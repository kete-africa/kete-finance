import { defineCommand } from '@kete/commands';
import { formatNumber, nextNumber } from '@kete/sequences';
import { CURRENCY, hrefOf, sayFact, type Fact } from '@/features/register';
import { moveMoney } from '@/features/treasury';
import { actingFor } from '@/platform/person';
import { outstandingOf, PURCHASE_NUMBERS, PurchaseRuleError } from '../domain/purchases';
import {
  findAdvance,
  insertAdvance,
  knownProjects,
  settleAdvance,
} from '../infrastructure/purchases.table';
import { projectOf } from '../projects';
import { advanceInput, advanceReturnInput, type Advance } from '../purchase.record';

/**
 * What the register says of an advance: the money that went out and is neither justified by a
 * note nor brought back yet. Each note it justifies says its own expense, on its own post: the
 * same franc is never counted twice.
 */
export function advanceFact(advance: Advance): Fact {
  return {
    key: `advance:${advance.advanceId}`,
    kind: 'spent',
    amount: outstandingOf(advance),
    currency: advance.currency,
    occurredOn: advance.givenOn,
    label: `${advance.number} — ${advance.purpose}`,
    projectId: advance.projectId,
    post: null,
    partyId: null,
    href: hrefOf('/achats/avances'),
  };
}

/** Gives a person money to spend for the organization: she then justifies it, or brings it back. */
export const giveAdvance = defineCommand({
  name: 'give-advance',
  input: advanceInput,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId, actor }) {
    // Who holds the till is rarely of the project's team: a project the center does not show
    // her is still named, when this app already knows it by what was asked on it.
    const project = input.projectId
      ? ((await projectOf(input.projectId)) ??
        (await knownProjects(db)).find((known) => known.projectId === input.projectId) ??
        null)
      : null;
    if (input.projectId && !project) throw new PurchaseRuleError('not_of_project');
    const now = new Date();
    const number = formatNumber(
      PURCHASE_NUMBERS.advance.pattern,
      await nextNumber(db, organizationId, {
        series: PURCHASE_NUMBERS.advance.series,
        period: String(now.getUTCFullYear()),
      }),
      now,
    );
    const advanceId = await insertAdvance(db, {
      organizationId,
      number,
      holder: { userId: input.holderId, name: input.holderName },
      purpose: input.purpose,
      projectId: input.projectId,
      projectName: project?.name ?? null,
      currency: CURRENCY,
      amount: input.amount,
      givenOn: input.givenOn,
      method: input.method,
      reference: input.reference,
      givenBy: actingFor(actor),
    });
    await moveMoney(db, organizationId, {
      direction: 'out',
      amount: input.amount,
      on: input.givenOn,
      method: input.method,
      label: `${number} — ${input.purpose}`,
      source: `advance:${advanceId}`,
      projectId: input.projectId ?? null,
      recordedBy: actingFor(actor),
    });
    const advance = await findAdvance(db, advanceId);
    if (advance) await sayFact(db, organizationId, advanceFact(advance));
    return { advanceId, number };
  },
  summarize: (input) => `Advance given to ${input.holderId}`,
});

/** Takes back what a holder did not spend — never more than what she still holds. */
export const returnAdvance = defineCommand({
  name: 'return-advance',
  input: advanceReturnInput,
  reversibility: { reversible: false },
  async handler({ advanceId, amount, returnedOn }, { db, organizationId, actor }) {
    const advance = await findAdvance(db, advanceId);
    if (!advance) throw new PurchaseRuleError('advance_not_found');
    if (advance.status === 'closed') throw new PurchaseRuleError('advance_closed');
    if (amount > outstandingOf(advance)) throw new PurchaseRuleError('more_than_advance');
    const after = await settleAdvance(db, advanceId, 'returned', amount);
    // What is brought back comes back the way it was given.
    await moveMoney(db, organizationId, {
      direction: 'in',
      amount,
      on: returnedOn,
      method: advance.method,
      label: `${advance.number} — ${advance.purpose}`,
      source: `advance-return:${advanceId}:${after.returned}`,
      projectId: advance.projectId,
      recordedBy: actingFor(actor),
    });
    await sayFact(db, organizationId, advanceFact(after));
    return { advanceId, outstanding: outstandingOf(after) };
  },
  summarize: ({ advanceId }) => `Advance ${advanceId}: money brought back`,
});
