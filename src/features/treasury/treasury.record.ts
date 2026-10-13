import { z } from 'zod';
import { receiptMethods } from '@/features/sales/methods';
import { accountKinds, type AccountKind, type Method } from './domain/treasury';

// Accounts, movements and closings, described once.

const amount = z.number().int().min(1).max(1_000_000_000_000);
const id = z.string().min(1).max(64);

export const accountInput = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(accountKinds),
  /** What it holds the day it is opened here; a bank account may open overdrawn. */
  opening: z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000).default(0),
  openedOn: z.iso.date(),
});

/** Money that came in or went out outside sales and purchases: bank fees, a contribution. */
export const movementInput = z.object({
  accountId: id,
  direction: z.enum(['in', 'out']),
  amount,
  on: z.iso.date(),
  label: z.string().trim().min(1).max(300),
});

/** Money carried from one account to another: the till's cash taken to the bank. */
export const transferInput = z.object({
  fromAccountId: id,
  toAccountId: id,
  amount,
  on: z.iso.date(),
  label: z.string().trim().max(300).optional(),
});

export const assignInput = z.object({ movementId: id, accountId: id });

/** A till counted at the end of its day: what is in the drawer, and a word when it differs. */
export const closingInput = z.object({
  accountId: id,
  closedOn: z.iso.date(),
  counted: z.number().int().min(0).max(1_000_000_000_000),
  note: z.string().trim().max(500).optional(),
});

export const methodOf = (kind: AccountKind): Method =>
  kind === 'till' ? 'cash' : kind === 'mobile' ? 'mobile' : 'bank';
export { receiptMethods };

export interface Account {
  accountId: string;
  name: string;
  kind: AccountKind;
  currency: string;
  opening: number;
  openedOn: string;
  active: boolean;
  balance: number;
  /** The last day it was closed, for a till: nothing dated then or before is taken any more. */
  closedOn: string | null;
}

export interface Movement {
  movementId: string;
  accountId: string | null;
  direction: 'in' | 'out';
  amount: number;
  on: string;
  method: Method;
  label: string;
  source: string | null;
  projectId: string | null;
}

export interface Closing {
  closingId: string;
  closedOn: string;
  expected: number;
  counted: number;
  difference: number;
  note: string | null;
}
