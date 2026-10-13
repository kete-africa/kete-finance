import { defineRecord, field } from '@kete/records';
import { z } from 'zod';
import type { InvoiceStatus, QuoteStatus } from './domain/sales';
import { receiptMethods, type ReceiptMethod } from './methods';

// Quotes, invoices and receipts, described once: the forms, the server's validation, the MCP
// tools' inputs and the drafts come from these schemas. Amounts are integers of the currency's
// smallest unit (@kete/money); labels are translation keys.

const amount = z.number().int().min(0).max(1_000_000_000_000);
const id = z.string().min(1).max(64);

export const quoteLineInput = z.object({
  label: z.string().trim().min(1).max(200),
  quantity: z.number().positive().max(1_000_000),
  unitPrice: amount,
  unitCost: amount.default(0),
  post: z.string().trim().min(1).max(80),
});

export const quoteInput = z.object({
  title: field(z.string().trim().min(1).max(200), { label: 'quote_title_label' }),
  /** The third party at the center (`pty_…`), when the client is one. */
  partyId: field(z.string().max(64).optional(), { label: 'quote_party_id_label' }),
  partyName: field(z.string().trim().min(1).max(200), { label: 'quote_party_label' }),
  taxRate: field(z.number().min(0).max(100).default(0), { label: 'quote_tax_label' }),
  validUntil: field(z.iso.date().optional(), { label: 'quote_valid_label' }),
  lines: z.array(quoteLineInput).min(1).max(200),
});

export const quoteRecord = defineRecord({
  type: 'quote',
  prefix: 'quo',
  schema: quoteInput,
  summarize: (quote) => `${quote.title} — ${quote.partyName}`,
});

export const quoteRef = z.object({ quoteId: id });
export const quoteChange = quoteInput.extend({ quoteId: id });

/** A part of a won quote, invoiced: a deposit of 30 %, then the rest. */
export const quoteInvoiceInput = z.object({
  quoteId: id,
  share: z.number().positive().max(100),
  /** The invoice's line, worded by who asks: « Acompte 30 % — D-2026-0001 ». */
  label: z.string().trim().min(1).max(200),
  dueOn: z.iso.date().optional(),
});

/** An invoice without a quote: a sale at the counter, a service. */
export const directInvoiceInput = z.object({
  title: z.string().trim().min(1).max(200),
  partyId: z.string().max(64).optional(),
  partyName: z.string().trim().min(1).max(200),
  /** The project it belongs to at the center (`prj_…`); without one, it is « Fonctionnement ». */
  projectId: z.string().max(64).optional(),
  taxRate: z.number().min(0).max(100).default(0),
  dueOn: z.iso.date().optional(),
  lines: z
    .array(quoteLineInput.pick({ label: true, quantity: true, unitPrice: true }))
    .min(1)
    .max(200),
});

export const invoiceRef = z.object({ invoiceId: id });

export { receiptMethods, type ReceiptMethod };

export const receiptInput = z.object({
  invoiceId: id,
  amount: amount.min(1),
  receivedOn: z.iso.date(),
  method: z.enum(receiptMethods),
  /** The proof: a transfer's reference, a cheque's number, a receipt's. */
  reference: z.string().trim().max(120).optional(),
});

export interface QuoteLine {
  label: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  post: string;
}

export interface Quote {
  quoteId: string;
  number: string;
  title: string;
  partyId: string | null;
  partyName: string;
  status: QuoteStatus;
  currency: string;
  taxRate: number;
  subtotal: number;
  tax: number;
  total: number;
  cost: number;
  validUntil: string | null;
  /** The project it opened at the center once won; null while the center has not answered. */
  projectId: string | null;
  projectName: string | null;
  /** What its invoices already took, drafts included. */
  invoiced: number;
  createdOn: string;
  lines: QuoteLine[];
}

export interface Invoice {
  invoiceId: string;
  /** Given when issued, never before, never changed. */
  number: string | null;
  quoteId: string | null;
  title: string;
  partyId: string | null;
  partyName: string;
  projectId: string | null;
  status: InvoiceStatus;
  currency: string;
  taxRate: number;
  subtotal: number;
  tax: number;
  total: number;
  received: number;
  issuedOn: string | null;
  dueOn: string | null;
  lines: { label: string; quantity: number; unitPrice: number }[];
  receipts: Receipt[];
}

export interface Receipt {
  receiptId: string;
  amount: number;
  receivedOn: string;
  method: ReceiptMethod;
  reference: string | null;
}
