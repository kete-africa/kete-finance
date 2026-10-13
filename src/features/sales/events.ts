import { z } from 'zod';

/**
 * The business events of sales: what the center may react to — an agent, a morning briefing, a
 * notification. Identifiers and figures only, never a name; the manifest lists them (`emits`).
 */
export const salesEvents = [
  {
    type: 'quote.won',
    description: 'A quote was won: its id, its number and its total.',
    classification: 'internal',
    data: z.object({
      quoteId: z.string(),
      number: z.string(),
      total: z.number(),
      currency: z.string(),
    }),
  },
  {
    type: 'invoice.issued',
    description: 'An invoice was issued: its id, its number and its total.',
    classification: 'internal',
    data: z.object({
      invoiceId: z.string(),
      number: z.string(),
      total: z.number(),
      currency: z.string(),
    }),
  },
  {
    type: 'receipt.recorded',
    description: 'Money was received on an invoice: the amount, and what stays due.',
    classification: 'internal',
    data: z.object({
      invoiceId: z.string(),
      receiptId: z.string(),
      amount: z.number(),
      due: z.number(),
    }),
  },
] as const;
