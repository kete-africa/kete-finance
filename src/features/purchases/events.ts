import { z } from 'zod';

/**
 * The business events of purchases and expenses: identifiers and figures only, never a name; the
 * manifest lists them (`emits`).
 */
export const purchasesEvents = [
  {
    type: 'purchase.asked',
    description:
      'A purchase or an expense note was asked: its id, its kind, its amount, and by how much it goes beyond its post.',
    classification: 'internal',
    data: z.object({
      requestId: z.string(),
      kind: z.enum(['purchase', 'expense']),
      amount: z.number(),
      currency: z.string(),
      beyondBy: z.number(),
    }),
  },
  {
    type: 'purchase.approved',
    description: 'A purchase or an expense note was approved: its id, its kind and its amount.',
    classification: 'internal',
    data: z.object({
      requestId: z.string(),
      kind: z.enum(['purchase', 'expense']),
      amount: z.number(),
    }),
  },
  {
    type: 'purchase.paid',
    description: 'A payment was recorded on a request: the amount, and what is still owed.',
    classification: 'internal',
    data: z.object({
      requestId: z.string(),
      paymentId: z.string(),
      amount: z.number(),
      owed: z.number(),
    }),
  },
] as const;
