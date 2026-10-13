import { defineCapability } from '@kete/capabilities';
import { money, toDecimal } from '@kete/money';
import { exposeRecord } from '@kete/views';
import * as m from '@/paraglide/messages.js';
import {
  createInvoice,
  discardInvoice,
  invoiceQuote,
  issueInvoice,
  recordReceipt,
} from './commands/invoices';
import { createQuote, loseQuote, sendQuote, updateQuote, winQuote } from './commands/quotes';
import {
  findInvoice,
  findQuote,
  searchInvoices,
  searchQuotes,
} from './infrastructure/sales.table';
import {
  directInvoiceInput,
  invoiceRef,
  quoteChange,
  quoteInput,
  quoteInvoiceInput,
  quoteRecord,
  quoteRef,
  receiptInput,
  type Invoice,
  type Quote,
} from './quote.record';

/** An amount for a copilot's table: in the main unit, with its currency. */
const shown = (amount: number, currency: string) => `${toDecimal(money(amount, currency))} ${currency}`;

/**
 * What agents may do with sales — through MCP, the chat or another app — and how far alone. An
 * agent reads; it prepares a quote or an invoice a person validates; issuing an invoice and
 * recording money are always a person's, with her confirmation (level 4).
 */
export const salesCapabilities = [
  ...exposeRecord<Quote>({
    type: 'quote',
    description: 'the quotes of the organization, the latest first: number, client, total, status',
    permission: 'sales:read',
    title: m.quotes_title,
    empty: m.quotes_empty,
    columns: [
      { key: 'number', label: m.doc_number, value: (q) => q.number },
      { key: 'title', label: m.quote_title_label, value: (q) => q.title },
      { key: 'party', label: m.quote_party_label, value: (q) => q.partyName },
      { key: 'total', label: m.doc_total, align: 'end', value: (q) => shown(q.total, q.currency) },
      { key: 'status', label: m.doc_status, value: (q) => q.status },
    ],
    list: (db, query) => searchQuotes(db, query),
    get: (db, id) => findQuote(db, id),
    label: (q) => `${q.number} — ${q.title}`,
  }),
  ...exposeRecord<Invoice>({
    type: 'invoice',
    description:
      'the invoices of the organization, the latest first: number, client, total, what is still due',
    permission: 'sales:read',
    title: m.invoices_title,
    empty: m.invoices_empty,
    columns: [
      { key: 'number', label: m.doc_number, value: (i) => i.number },
      { key: 'party', label: m.quote_party_label, value: (i) => i.partyName },
      { key: 'total', label: m.doc_total, align: 'end', value: (i) => shown(i.total, i.currency) },
      {
        key: 'due',
        label: m.invoice_due,
        align: 'end',
        value: (i) => shown(i.total - i.received, i.currency),
      },
      { key: 'status', label: m.doc_status, value: (i) => i.status },
    ],
    list: (db, query) => searchInvoices(db, query),
    get: (db, id) => findInvoice(db, id),
    label: (i) => `${i.number ?? i.title} — ${i.partyName}`,
  }),
  defineCapability({
    name: 'quotes_create',
    description:
      'Writes a quote for a client: its lines with quantity, unit price, unit cost and budget post. Amounts are integers of the currency’s smallest unit.',
    permission: 'sales:write',
    autonomy: 3,
    input: quoteInput,
    command: createQuote,
    draft: { recordType: 'quote', definition: quoteRecord },
  }),
  defineCapability({
    name: 'quotes_update',
    description: 'Rewrites a quote that is still a draft.',
    permission: 'sales:write',
    autonomy: 3,
    input: quoteChange,
    command: updateQuote,
    draft: { recordType: 'quote_change' },
  }),
  defineCapability({
    name: 'quotes_send',
    description: 'Marks a quote as sent to the client: it can no longer be rewritten.',
    permission: 'sales:write',
    autonomy: 3,
    input: quoteRef,
    command: sendQuote,
    draft: { recordType: 'quote_sent' },
  }),
  defineCapability({
    name: 'quotes_win',
    description:
      'Marks a quote as won: its project is then opened at the center with the budget of its lines.',
    permission: 'sales:write',
    autonomy: 3,
    input: quoteRef,
    command: winQuote,
    draft: { recordType: 'quote_won' },
  }),
  defineCapability({
    name: 'quotes_lose',
    description: 'Marks a quote as lost.',
    permission: 'sales:write',
    autonomy: 3,
    input: quoteRef,
    command: loseQuote,
    draft: { recordType: 'quote_lost' },
  }),
  defineCapability({
    name: 'invoices_from_quote',
    description:
      'Prepares the invoice of a share (in percent) of a won quote: a deposit, a stage, or what is left.',
    permission: 'sales:write',
    autonomy: 3,
    input: quoteInvoiceInput,
    command: invoiceQuote,
    draft: { recordType: 'invoice_of_quote' },
  }),
  defineCapability({
    name: 'invoices_create',
    description: 'Prepares an invoice without a quote, from its lines.',
    permission: 'sales:write',
    autonomy: 3,
    input: directInvoiceInput,
    command: createInvoice,
    draft: { recordType: 'invoice_direct' },
  }),
  defineCapability({
    name: 'invoices_discard',
    description: 'Throws away an invoice that is still a draft.',
    permission: 'sales:write',
    autonomy: 3,
    input: invoiceRef,
    command: discardInvoice,
    draft: { recordType: 'invoice_discarded' },
  }),
  defineCapability({
    name: 'invoices_issue',
    description:
      'Issues an invoice: it takes its number for good and can no longer be changed nor deleted.',
    permission: 'sales:issue',
    autonomy: 4,
    input: invoiceRef,
    command: issueInvoice,
    draft: { recordType: 'invoice_issued' },
  }),
  defineCapability({
    name: 'receipts_record',
    description: 'Records money received on an issued invoice, with its proof.',
    permission: 'sales:collect',
    autonomy: 4,
    input: receiptInput,
    command: recordReceipt,
    draft: { recordType: 'receipt' },
  }),
];
