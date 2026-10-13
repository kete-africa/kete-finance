import { defineCapability } from '@kete/capabilities';
import { money, toDecimal } from '@kete/money';
import { z } from 'zod';
import { giveAdvance, returnAdvance } from './commands/advances';
import {
  askPurchase,
  correctRequest,
  decideRequest,
  fileExpense,
  orderPurchase,
  payRequest,
} from './commands/requests';
import {
  findRequest,
  listAdvances,
  pricesOf,
  searchRequests,
} from './infrastructure/purchases.table';
import {
  advanceInput,
  advanceReturnInput,
  correctionInput,
  decideInput,
  expenseInput,
  orderInput,
  paymentInput,
  purchaseInput,
  requestRef,
} from './purchase.record';

const shown = (amount: number, currency: string) => `${toDecimal(money(amount, currency))} ${currency}`;

/** Whether the caller reads every request, or only her own: set by the host for each call. */
let readsAll: () => boolean = () => false;
export function useReadsAll(check: () => boolean): void {
  readsAll = check;
}

/**
 * What agents may do with purchases — through MCP, the chat or another app — and how far alone.
 * An agent reads and recalls prices; it prepares a request a person validates; approving,
 * ordering and paying are a person's, and paying needs her confirmation (level 4).
 */
export const purchasesCapabilities = [
  defineCapability({
    name: 'purchase_list',
    description:
      'The purchase requests and expense notes, the latest first: number, title, amount, status, and by how much each goes beyond its budget post. Her own, unless she reads them all.',
    permission: 'purchases:ask',
    autonomy: 1,
    input: z.object({ text: z.string().max(100).optional() }),
    async run({ text }, { db, actor }) {
      const requests = await searchRequests(db, {
        text,
        requesterId: readsAll() ? undefined : (actor.onBehalfOf?.id ?? actor.id),
        limit: 50,
      });
      return requests.map((request) => ({
        requestId: request.requestId,
        number: request.number,
        kind: request.kind,
        title: request.title,
        amount: shown(request.amount, request.currency),
        status: request.status,
        project: request.projectName,
        post: request.post,
        beyondBy: request.standing?.beyondBy
          ? shown(request.standing.beyondBy, request.currency)
          : null,
      }));
    },
  }),
  defineCapability({
    name: 'purchase_get',
    description: 'A purchase request or an expense note, with its lines, its decision and its payments.',
    permission: 'purchases:ask',
    autonomy: 1,
    input: requestRef,
    async run({ requestId }, { db, actor }) {
      const request = await findRequest(db, requestId);
      if (!request) return null;
      const hers = request.requester.userId === (actor.onBehalfOf?.id ?? actor.id);
      return hers || readsAll() ? request : null;
    },
  }),
  defineCapability({
    name: 'prices_recall',
    description:
      'The memory of prices: what a thing was last bought for, from whom and when. Use it before asking for a purchase.',
    permission: 'purchases:ask',
    autonomy: 1,
    input: z.object({ text: z.string().trim().min(2).max(100) }),
    run: ({ text }, { db }) => pricesOf(db, text),
  }),
  defineCapability({
    name: 'advance_list',
    description: 'The advances given to people and what each still has to justify or bring back.',
    permission: 'purchases:ask',
    autonomy: 1,
    input: z.object({}),
    run: (_input, { db, actor }) =>
      listAdvances(db, readsAll() ? {} : { holderId: actor.onBehalfOf?.id ?? actor.id }),
  }),
  defineCapability({
    name: 'purchases_ask',
    description:
      'Asks for a purchase: its lines, its supplier when known, its project and the post of its budget. Amounts are integers of the currency’s smallest unit.',
    permission: 'purchases:ask',
    autonomy: 3,
    input: purchaseInput,
    command: askPurchase,
    draft: { recordType: 'purchase_request' },
  }),
  defineCapability({
    name: 'expenses_file',
    description:
      'Files an expense note: what she already paid, on which day, with its proof — to be paid back, or to justify an advance.',
    permission: 'purchases:ask',
    autonomy: 3,
    input: expenseInput,
    command: fileExpense,
    draft: { recordType: 'expense_note' },
  }),
  defineCapability({
    name: 'purchases_correct',
    description: 'Corrects a request that was sent back to who asked: it is then decided again.',
    permission: 'purchases:ask',
    autonomy: 3,
    input: correctionInput,
    command: correctRequest,
    draft: { recordType: 'purchase_correction' },
  }),
  defineCapability({
    name: 'purchases_decide',
    description:
      'Approves, refuses or sends back a request, when the organization has no circuit for it at the center.',
    permission: 'purchases:approve',
    autonomy: 3,
    input: decideInput,
    command: decideRequest,
    draft: { recordType: 'purchase_decision' },
  }),
  defineCapability({
    name: 'purchases_order',
    description: 'Orders an approved purchase: it takes its order number and names its supplier.',
    permission: 'purchases:order',
    autonomy: 3,
    input: orderInput,
    command: orderPurchase,
    draft: { recordType: 'purchase_order' },
  }),
  defineCapability({
    name: 'purchases_pay',
    description: 'Records a payment on an approved request, with its proof.',
    permission: 'purchases:pay',
    autonomy: 4,
    input: paymentInput,
    command: payRequest,
    draft: { recordType: 'purchase_payment' },
  }),
  defineCapability({
    name: 'advances_give',
    description: 'Gives a person an advance to spend for the organization.',
    permission: 'purchases:pay',
    autonomy: 4,
    input: advanceInput,
    command: giveAdvance,
    draft: { recordType: 'advance' },
  }),
  defineCapability({
    name: 'advances_return',
    description: 'Records what the holder of an advance brought back.',
    permission: 'purchases:pay',
    autonomy: 4,
    input: advanceReturnInput,
    command: returnAdvance,
    draft: { recordType: 'advance_return' },
  }),
];
