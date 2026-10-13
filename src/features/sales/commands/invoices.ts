import { defineCommand } from '@kete/commands';
import { formatNumber, nextNumber } from '@kete/sequences';
import { CURRENCY, hrefOf, sayFact, today } from '@/features/register';
import { announce } from '@/platform/announce';
import { dueAfter, NUMBERS, partOf, SalesRuleError, totalsOf } from '../domain/sales';
import {
  deleteDraftInvoice,
  findInvoice,
  findQuote,
  insertInvoice,
  insertReceipt,
  invoicedOf,
  issueInvoice as markIssued,
} from '../infrastructure/sales.table';
import {
  directInvoiceInput,
  invoiceRef,
  quoteInvoiceInput,
  receiptInput,
  type Invoice,
} from '../quote.record';

const hrefOfInvoice = (invoiceId: string) => hrefOf(`/ventes/factures/${invoiceId}`);

/** What the register says of an issued invoice: what is still due on it. */
const dueFact = (invoice: Invoice, due: number) => ({
  key: `invoice:${invoice.invoiceId}`,
  kind: 'invoiced' as const,
  amount: due,
  currency: invoice.currency,
  occurredOn: invoice.issuedOn ?? today(),
  label: `${invoice.number ?? ''} — ${invoice.partyName}`,
  projectId: invoice.projectId,
  post: null,
  partyId: invoice.partyId,
  href: hrefOfInvoice(invoice.invoiceId),
});

/** Prepares the invoice of a part of a won quote: a deposit, a stage, the rest. */
export const invoiceQuote = defineCommand({
  name: 'invoice-quote',
  input: quoteInvoiceInput,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId, actor }) {
    const quote = await findQuote(db, input.quoteId);
    if (!quote) throw new SalesRuleError('quote_not_found');
    if (quote.status !== 'won') throw new SalesRuleError('quote_not_won');
    const part = partOf(quote, await invoicedOf(db, quote.quoteId), input.share, quote.currency);
    const invoiceId = await insertInvoice(db, {
      organizationId,
      quoteId: quote.quoteId,
      title: quote.title,
      partyId: quote.partyId,
      partyName: quote.partyName,
      projectId: quote.projectId,
      currency: quote.currency,
      taxRate: quote.taxRate,
      ...part,
      dueOn: input.dueOn,
      createdBy: actor.id,
      lines: [{ label: input.label, quantity: 1, unitPrice: part.subtotal }],
    });
    return { invoiceId, total: part.total };
  },
  summarize: ({ quoteId, share }) => `Invoice of ${share} % of quote ${quoteId} prepared`,
});

/** Prepares an invoice without a quote. */
export const createInvoice = defineCommand({
  name: 'create-invoice',
  input: directInvoiceInput,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId, actor }) {
    const totals = totalsOf(
      input.lines.map((line) => ({ ...line, unitCost: 0 })),
      input.taxRate,
      CURRENCY,
    );
    const invoiceId = await insertInvoice(db, {
      organizationId,
      title: input.title,
      partyId: input.partyId,
      partyName: input.partyName,
      projectId: input.projectId,
      currency: CURRENCY,
      taxRate: input.taxRate,
      subtotal: totals.subtotal,
      tax: totals.tax,
      total: totals.total,
      dueOn: input.dueOn,
      createdBy: actor.id,
      lines: input.lines,
    });
    return { invoiceId, total: totals.total };
  },
  summarize: (input) => `Invoice "${input.title}" prepared`,
});

/**
 * Issues an invoice: it takes the next number of the year — no gap, no number twice — and its
 * day, and the register says what is due. From here it is never changed nor deleted.
 */
export const issueInvoice = defineCommand({
  name: 'issue-invoice',
  input: invoiceRef,
  reversibility: { reversible: false },
  async handler({ invoiceId }, { db, organizationId, actor }) {
    const invoice = await findInvoice(db, invoiceId);
    if (!invoice) throw new SalesRuleError('invoice_not_found');
    if (invoice.status !== 'draft') throw new SalesRuleError('invoice_not_draft');
    const now = new Date();
    const number = formatNumber(
      NUMBERS.invoice.pattern,
      await nextNumber(db, organizationId, {
        series: NUMBERS.invoice.series,
        period: String(now.getUTCFullYear()),
      }),
      now,
    );
    const issuedOn = today(now);
    await markIssued(db, invoiceId, { number, issuedOn, issuedBy: actor.id });
    await sayFact(
      db,
      organizationId,
      dueFact({ ...invoice, number, issuedOn }, invoice.total - invoice.received),
    );
    await announce(db, {
      type: 'invoice.issued',
      organization: organizationId,
      data: { invoiceId, number, total: invoice.total, currency: invoice.currency },
    });
    return { invoiceId, number };
  },
  summarize: ({ invoiceId }) => `Invoice ${invoiceId} issued`,
});

/** Throws a draft away: it had no number, nothing is lost. */
export const discardInvoice = defineCommand({
  name: 'discard-invoice',
  input: invoiceRef,
  reversibility: { reversible: false },
  async handler({ invoiceId }, { db }) {
    const invoice = await findInvoice(db, invoiceId);
    if (!invoice) throw new SalesRuleError('invoice_not_found');
    if (invoice.status !== 'draft') throw new SalesRuleError('invoice_not_draft');
    await deleteDraftInvoice(db, invoiceId);
    return { invoiceId };
  },
  summarize: ({ invoiceId }) => `Draft invoice ${invoiceId} discarded`,
});

/**
 * Records money received on an issued invoice — never more than what is due. The register says
 * what came in, and what stays due.
 */
export const recordReceipt = defineCommand({
  name: 'record-receipt',
  input: receiptInput,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId, actor }) {
    const invoice = await findInvoice(db, input.invoiceId);
    if (!invoice) throw new SalesRuleError('invoice_not_found');
    if (invoice.status !== 'issued') throw new SalesRuleError('invoice_not_issued');
    const due = dueAfter(invoice, input.amount);
    const receiptId = await insertReceipt(db, {
      organizationId,
      invoiceId: invoice.invoiceId,
      amount: input.amount,
      receivedOn: input.receivedOn,
      method: input.method,
      reference: input.reference,
      recordedBy: actor.id,
    });
    await sayFact(db, organizationId, dueFact(invoice, due));
    await sayFact(db, organizationId, {
      key: `receipt:${receiptId}`,
      kind: 'received',
      amount: input.amount,
      currency: invoice.currency,
      occurredOn: input.receivedOn,
      label: `${invoice.number ?? ''} — ${invoice.partyName}`,
      projectId: invoice.projectId,
      post: null,
      partyId: invoice.partyId,
      href: hrefOfInvoice(invoice.invoiceId),
    });
    await announce(db, {
      type: 'receipt.recorded',
      organization: organizationId,
      data: { invoiceId: invoice.invoiceId, receiptId, amount: input.amount, due },
    });
    return { receiptId, due };
  },
  summarize: ({ invoiceId }) => `Receipt recorded on invoice ${invoiceId}`,
});
