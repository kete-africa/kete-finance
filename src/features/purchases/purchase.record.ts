import { z } from 'zod';
import { receiptMethods, type ReceiptMethod } from '@/features/sales/methods';
import type { RequestKind, RequestStatus, Route } from './domain/purchases';

// Purchase requests, expense notes and advances, described once: the forms, the server's
// validation and the MCP tools' inputs come from these schemas.

const amount = z.number().int().min(1).max(1_000_000_000_000);
const id = z.string().min(1).max(64);

const line = z.object({
  label: z.string().trim().min(1).max(200),
  quantity: z.number().positive().max(1_000_000),
  unitPrice: z.number().int().min(0).max(1_000_000_000_000),
});

/** What a request says, asked for the first time or corrected after it was sent back. */
const asked = z.object({
  title: z.string().trim().min(1).max(200),
  /** The supplier at the center (`pty_…`), when it is known; an order needs one. */
  partyId: z.string().max(64).optional(),
  partyName: z.string().trim().max(200).optional(),
  /** The project it is for (`prj_…`); without one, it is the running of the organization. */
  projectId: z.string().max(64).optional(),
  /** The post of the project's budget it counts against: required with a project. */
  post: z.string().trim().min(1).max(80).optional(),
  lines: z.array(line).min(1).max(100),
});

export const purchaseInput = asked;

export const expenseInput = asked.omit({ partyId: true, partyName: true }).extend({
  /** The day she paid. */
  spentOn: z.iso.date(),
  /** The proof: the receipt's number, where the ticket is kept. */
  proof: z.string().trim().max(200).optional(),
  /** The advance it justifies, when it was paid with one. */
  advanceId: z.string().max(64).optional(),
});

export const requestRef = z.object({ requestId: id });
export const correctionInput = asked.extend({ requestId: id });

export const decideInput = z.object({
  requestId: id,
  decision: z.enum(['approve', 'refuse', 'return']),
  reason: z.string().trim().max(1000).optional(),
});

/** A decision taken at the center, applied here by the app itself. */
export const settledInput = decideInput.extend({ by: z.string().min(1).max(200) });

export const orderInput = z.object({
  requestId: id,
  partyId: z.string().max(64).optional(),
  partyName: z.string().trim().min(1).max(200).optional(),
});

export const paymentInput = z.object({
  requestId: id,
  amount,
  paidOn: z.iso.date(),
  method: z.enum(receiptMethods),
  /** The proof: a transfer's reference, a cheque's number, a signed receipt's. */
  reference: z.string().trim().max(120).optional(),
});

export const advanceInput = z.object({
  holderId: z.string().min(1).max(64),
  holderName: z.string().trim().min(1).max(200),
  purpose: z.string().trim().min(1).max(200),
  projectId: z.string().max(64).optional(),
  amount,
  givenOn: z.iso.date(),
  method: z.enum(receiptMethods),
  reference: z.string().trim().max(120).optional(),
});

export const advanceReturnInput = z.object({
  advanceId: id,
  amount,
  returnedOn: z.iso.date(),
});

export interface PurchaseRequest {
  requestId: string;
  number: string;
  kind: RequestKind;
  title: string;
  requester: { userId: string; name: string };
  partyId: string | null;
  partyName: string | null;
  projectId: string | null;
  projectName: string | null;
  post: string | null;
  currency: string;
  amount: number;
  paid: number;
  /** Its post when it was asked: the budget, what was left, and by how much it goes beyond. */
  standing: { budget: number; left: number; beyondBy: number } | null;
  status: RequestStatus;
  route: Route;
  /** The request at the center, when its circuits decide. */
  decisionRequestId: string | null;
  /** The subject it was asked under at the center. */
  decisionSubject: string | null;
  /** What its funders said in Kete Commitments: allowed, not asked, or no funder (null). */
  agreement: 'allowed' | 'unchecked' | null;
  decided: { by: string; reason: string | null } | null;
  orderNumber: string | null;
  spentOn: string | null;
  proof: string | null;
  advanceId: string | null;
  askedOn: string;
  lines: { label: string; quantity: number; unitPrice: number }[];
  payments: {
    paymentId: string;
    amount: number;
    paidOn: string;
    method: ReceiptMethod;
    reference: string | null;
  }[];
}

export interface Advance {
  advanceId: string;
  number: string;
  holder: { userId: string; name: string };
  purpose: string;
  projectId: string | null;
  projectName: string | null;
  currency: string;
  amount: number;
  justified: number;
  returned: number;
  givenOn: string;
  /** How it was given: what is brought back comes back the same way. */
  method: ReceiptMethod;
  status: 'open' | 'closed';
}
