import { defineCommand, type Actor } from '@kete/commands';
import { formatNumber, nextNumber } from '@kete/sequences';
import type { SqlExecutor } from '@kete/tenancy';
import { z } from 'zod';
import { CURRENCY, engagedOn, hrefOf, sayFact, today } from '@/features/register';
import { moveMoney } from '@/features/treasury';
import { announce } from '@/platform/announce';
import { actingFor, currentName } from '@/platform/person';
import {
  amountOf,
  outstandingOf,
  owedAfter,
  PURCHASE_NUMBERS,
  PurchaseRuleError,
  standingOf,
  type RequestKind,
} from '../domain/purchases';
import {
  findAdvance,
  findRequest,
  insertPayment,
  insertRequest,
  rewriteRequest,
  setDecided,
  setOrdered,
  setRoute,
  settleAdvance,
  waitingOn,
} from '../infrastructure/purchases.table';
import { checkAgreements } from '../agreements';
import { postOf, projectOf } from '../projects';
import {
  correctionInput,
  decideInput,
  expenseInput,
  orderInput,
  paymentInput,
  purchaseInput,
  requestRef,
  settledInput,
  type Advance,
  type PurchaseRequest,
} from '../purchase.record';
import { advanceFact } from './advances';

const hrefOfRequest = (requestId: string) => hrefOf(`/achats/${requestId}`);
const labelOf = (request: Pick<PurchaseRequest, 'number' | 'title'>) =>
  `${request.number} — ${request.title}`;

async function numbered(
  db: SqlExecutor,
  organizationId: string,
  of: keyof typeof PURCHASE_NUMBERS,
): Promise<string> {
  const now = new Date();
  const { series, pattern } = PURCHASE_NUMBERS[of];
  return formatNumber(
    pattern,
    await nextNumber(db, organizationId, { series, period: String(now.getUTCFullYear()) }),
    now,
  );
}

/**
 * Where a request falls: its project — she must belong to it — and how its amount stands against
 * its post once everything engaged on it is taken off: committed, spent, and what is asked and
 * waits. Without a project it is the running of the organization: no post, no budget.
 */
async function placed(
  db: SqlExecutor,
  input: {
    projectId?: string | undefined;
    post?: string | undefined;
    title: string;
    lines: readonly { label: string }[];
    spentOn?: string | undefined;
  },
  amount: number,
  except?: string,
) {
  if (!input.projectId) {
    return { projectName: null, post: undefined, standing: null, agreement: null };
  }
  if (!input.post) throw new PurchaseRuleError('post_required');
  const project = await projectOf(input.projectId);
  if (!project) throw new PurchaseRuleError('not_of_project');
  const post = postOf(project, input.post);
  const engaged =
    (await engagedOn(db, input.projectId, post.name)) +
    (await waitingOn(db, input.projectId, post.name, except));
  // What its funders allow: refused, it is not written at all, and the passage is said.
  const verdict = await checkAgreements({
    projectId: input.projectId,
    post: post.name,
    amount,
    label: [input.title, ...input.lines.map((line) => line.label)].join(' — '),
    on: input.spentOn ?? today(),
  });
  if (verdict.state === 'refused') {
    throw new PurchaseRuleError('refused_by_agreement', {
      agreement: verdict.agreement,
      clause: verdict.clause,
    });
  }
  return {
    projectName: project.name,
    post: post.name,
    standing: standingOf(post.budget, engaged, amount),
    agreement: verdict.state === 'none' ? null : verdict.state,
  };
}

/** An advance an expense note may justify: hers, open, with enough left. */
async function advanceFor(
  db: SqlExecutor,
  advanceId: string,
  holderId: string,
  amount: number,
): Promise<Advance> {
  const advance = await findAdvance(db, advanceId);
  if (!advance) throw new PurchaseRuleError('advance_not_found');
  if (advance.holder.userId !== holderId) throw new PurchaseRuleError('not_the_holder');
  if (advance.status === 'closed') throw new PurchaseRuleError('advance_closed');
  if (amount > outstandingOf(advance)) throw new PurchaseRuleError('more_than_advance');
  return advance;
}

/** Opens a request of `kind` for who asks: placed against its post, numbered, announced. */
async function ask(
  { db, organizationId, actor }: { db: SqlExecutor; organizationId: string; actor: Actor },
  kind: RequestKind,
  input: z.output<typeof purchaseInput> & Partial<z.output<typeof expenseInput>>,
) {
  {
    const requesterId = actingFor(actor);
    const amount = amountOf(input.lines, CURRENCY);
    const place = await placed(db, input, amount);
    if (input.advanceId) await advanceFor(db, input.advanceId, requesterId, amount);
    const number = await numbered(db, organizationId, kind);
    const requestId = await insertRequest(db, {
      organizationId,
      number,
      kind,
      title: input.title,
      requester: { userId: requesterId, name: currentName(requesterId) },
      partyId: input.partyId,
      partyName: input.partyName,
      projectId: input.projectId,
      projectName: place.projectName,
      post: place.post,
      currency: CURRENCY,
      amount,
      standing: place.standing,
      agreement: place.agreement,
      lines: input.lines,
      spentOn: input.spentOn,
      proof: input.proof,
      advanceId: input.advanceId,
    });
    await announce(db, {
      type: 'purchase.asked',
      organization: organizationId,
      data: { requestId, kind, amount, currency: CURRENCY, beyondBy: place.standing?.beyondBy ?? 0 },
    });
    return { requestId, number, amount, beyondBy: place.standing?.beyondBy ?? 0 };
  }
}

/** Asks for a purchase: what, for which project and post, from whom if it is known. */
export const askPurchase = defineCommand({
  name: 'ask-purchase',
  input: purchaseInput,
  reversibility: { reversible: false },
  handler: (input, context) => ask(context, 'purchase', input),
  summarize: (input) => `Purchase "${input.title}" asked`,
});

/** Files an expense note: what she already paid, to be paid back or to justify an advance. */
export const fileExpense = defineCommand({
  name: 'file-expense',
  input: expenseInput,
  reversibility: { reversible: false },
  handler: (input, context) => ask(context, 'expense', input),
  summarize: (input) => `Expense note "${input.title}" filed`,
});

/** Who asked corrects what was sent back to her: it waits again, and is decided again. */
export const correctRequest = defineCommand({
  name: 'correct-request',
  input: correctionInput,
  reversibility: { reversible: false },
  async handler({ requestId, ...input }, { db, organizationId, actor }) {
    const request = await findRequest(db, requestId);
    if (!request) throw new PurchaseRuleError('request_not_found');
    if (request.requester.userId !== actingFor(actor)) {
      throw new PurchaseRuleError('not_the_requester');
    }
    if (request.status !== 'returned') throw new PurchaseRuleError('request_not_returned');
    const amount = amountOf(input.lines, request.currency);
    const place = await placed(db, input, amount, requestId);
    if (request.advanceId) {
      await advanceFor(db, request.advanceId, request.requester.userId, amount);
    }
    await rewriteRequest(db, organizationId, requestId, {
      title: input.title,
      partyId: input.partyId,
      partyName: input.partyName,
      projectId: input.projectId,
      projectName: place.projectName,
      post: place.post,
      amount,
      standing: place.standing,
      agreement: place.agreement,
      lines: input.lines,
    });
    return { requestId, amount, beyondBy: place.standing?.beyondBy ?? 0 };
  },
  summarize: ({ requestId }) => `Request ${requestId} corrected`,
});

/**
 * A decision, applied: sent back with its reason, refused, or approved — then the register says
 * what the organization owes. An expense note paid with an advance is settled at once: the
 * advance is justified by its amount.
 */
async function settle(
  db: SqlExecutor,
  organizationId: string,
  request: PurchaseRequest,
  decision: 'approve' | 'refuse' | 'return',
  decided: { by: string; reason?: string | undefined },
) {
  if (request.status !== 'asked') throw new PurchaseRuleError('request_not_waiting');
  if (decision === 'return') {
    if (!decided.reason) throw new PurchaseRuleError('reason_required');
    await setDecided(db, request.requestId, 'returned', decided);
    return { requestId: request.requestId, status: 'returned' as const };
  }
  if (decision === 'refuse') {
    await setDecided(db, request.requestId, 'refused', decided);
    return { requestId: request.requestId, status: 'refused' as const };
  }
  const fact = {
    currency: request.currency,
    label: labelOf(request),
    projectId: request.projectId,
    post: request.post,
    partyId: request.partyId,
    href: hrefOfRequest(request.requestId),
  };
  if (request.advanceId) {
    await advanceFor(db, request.advanceId, request.requester.userId, request.amount);
    const advance = await settleAdvance(db, request.advanceId, 'justified', request.amount);
    await setDecided(db, request.requestId, 'paid', decided);
    await sayFact(db, organizationId, {
      ...fact,
      key: `expense:${request.requestId}`,
      kind: 'spent',
      amount: request.amount,
      occurredOn: request.spentOn ?? today(),
    });
    await sayFact(db, organizationId, advanceFact(advance));
  } else {
    await setDecided(db, request.requestId, 'approved', decided);
    await sayFact(db, organizationId, {
      ...fact,
      key: `purchase:${request.requestId}`,
      kind: 'committed',
      amount: request.amount - request.paid,
      occurredOn: today(),
    });
  }
  await announce(db, {
    type: 'purchase.approved',
    organization: organizationId,
    data: { requestId: request.requestId, kind: request.kind, amount: request.amount },
  });
  return {
    requestId: request.requestId,
    status: request.advanceId ? ('paid' as const) : ('approved' as const),
  };
}

/**
 * Decides a request here, when the organization has no circuit for it at the center: by who may
 * approve purchases — never by who asked.
 */
export const decideRequest = defineCommand({
  name: 'decide-request',
  input: decideInput,
  reversibility: { reversible: false },
  async handler({ requestId, decision, reason }, { db, organizationId, actor }) {
    const request = await findRequest(db, requestId);
    if (!request) throw new PurchaseRuleError('request_not_found');
    if (request.route !== 'here') throw new PurchaseRuleError('decided_at_the_center');
    const by = actingFor(actor);
    if (request.requester.userId === by) throw new PurchaseRuleError('own_request');
    return settle(db, organizationId, request, decision, { by: currentName(by), reason });
  },
  summarize: ({ requestId, decision }) => `Request ${requestId}: ${decision}`,
});

/** Applies what the center's circuits decided. Run by the app when the center says so. */
export const settleRequest = defineCommand({
  name: 'settle-request',
  input: settledInput,
  reversibility: { reversible: false },
  async handler({ requestId, decision, reason, by }, { db, organizationId }) {
    const request = await findRequest(db, requestId);
    if (!request) throw new PurchaseRuleError('request_not_found');
    return settle(db, organizationId, request, decision, { by, reason });
  },
  summarize: ({ requestId, decision }) => `Request ${requestId}: ${decision} at the center`,
});

/** Says who decides a request: the center's circuits, or this app. Run by the app. */
export const routeRequest = defineCommand({
  name: 'route-request',
  input: requestRef.extend({
    route: z.enum(['center', 'here']),
    decisionRequestId: z.string().max(64).optional(),
    decisionSubject: z.string().max(64).optional(),
    approverId: z.string().max(100).optional(),
  }),
  reversibility: { reversible: false },
  async handler({ requestId, route, decisionRequestId, decisionSubject, approverId }, { db }) {
    await setRoute(
      db,
      requestId,
      route,
      decisionRequestId && decisionSubject
        ? { requestId: decisionRequestId, subject: decisionSubject }
        : null,
      approverId ?? null,
    );
    return { requestId, route };
  },
  summarize: ({ requestId, route }) => `Request ${requestId} decided ${route}`,
});

/** Orders an approved purchase: it takes its order number, and names its supplier. */
export const orderPurchase = defineCommand({
  name: 'order-purchase',
  input: orderInput,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId }) {
    const request = await findRequest(db, input.requestId);
    if (!request) throw new PurchaseRuleError('request_not_found');
    if (request.kind !== 'purchase' || request.status !== 'approved') {
      throw new PurchaseRuleError('request_not_approved');
    }
    const partyName = input.partyName ?? request.partyName;
    if (!partyName) throw new PurchaseRuleError('supplier_required');
    const number = await numbered(db, organizationId, 'order');
    await setOrdered(db, request.requestId, { number, partyId: input.partyId, partyName });
    return { requestId: request.requestId, orderNumber: number };
  },
  summarize: ({ requestId }) => `Purchase ${requestId} ordered`,
});

/**
 * Records a payment on an approved request, with its proof — never more than what is owed, and
 * never by who asked. The register says what went out, and what is still to pay.
 */
export const payRequest = defineCommand({
  name: 'pay-request',
  input: paymentInput,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId, actor }) {
    const request = await findRequest(db, input.requestId);
    if (!request) throw new PurchaseRuleError('request_not_found');
    if (request.status !== 'approved' && request.status !== 'ordered') {
      throw new PurchaseRuleError('request_not_payable');
    }
    const by = actingFor(actor);
    if (request.requester.userId === by) throw new PurchaseRuleError('own_request');
    const owed = owedAfter(request, input.amount);
    const paymentId = await insertPayment(db, {
      organizationId,
      requestId: request.requestId,
      amount: input.amount,
      paidOn: input.paidOn,
      method: input.method,
      reference: input.reference,
      recordedBy: by,
      settles: owed === 0,
    });
    await moveMoney(db, organizationId, {
      direction: 'out',
      amount: input.amount,
      on: input.paidOn,
      method: input.method,
      label: labelOf(request),
      source: `payment:${paymentId}`,
      projectId: request.projectId,
      recordedBy: by,
    });
    const fact = {
      currency: request.currency,
      label: labelOf(request),
      projectId: request.projectId,
      post: request.post,
      partyId: request.partyId,
      href: hrefOfRequest(request.requestId),
    };
    await sayFact(db, organizationId, {
      ...fact,
      key: `payment:${paymentId}`,
      kind: 'spent',
      amount: input.amount,
      occurredOn: input.paidOn,
    });
    await sayFact(db, organizationId, {
      ...fact,
      key: `purchase:${request.requestId}`,
      kind: 'committed',
      amount: owed,
      occurredOn: today(),
    });
    await announce(db, {
      type: 'purchase.paid',
      organization: organizationId,
      data: { requestId: request.requestId, paymentId, amount: input.amount, owed },
    });
    return { paymentId, owed };
  },
  summarize: ({ requestId }) => `Payment recorded on request ${requestId}`,
});
