import { defineCommand } from '@kete/commands';
import { formatNumber, nextNumber } from '@kete/sequences';
import { z } from 'zod';
import { CURRENCY, moveFacts } from '@/features/register';
import { announce } from '@/platform/announce';
import { closed, NUMBERS, SalesRuleError, sent, totalsOf } from '../domain/sales';
import {
  findInvoice,
  findQuote,
  insertQuote,
  rewriteQuote,
  setQuoteProject,
  setQuoteStatus,
} from '../infrastructure/sales.table';
import { quoteChange, quoteInput, quoteRef } from '../quote.record';

/** Writes a quote: numbered at once, its totals and its cost computed from its lines. */
export const createQuote = defineCommand({
  name: 'create-quote',
  input: quoteInput,
  reversibility: { reversible: false },
  async handler(input, { db, organizationId, actor }) {
    const now = new Date();
    const number = formatNumber(
      NUMBERS.quote.pattern,
      await nextNumber(db, organizationId, {
        series: NUMBERS.quote.series,
        period: String(now.getUTCFullYear()),
      }),
      now,
    );
    const totals = totalsOf(input.lines, input.taxRate, CURRENCY);
    const quoteId = await insertQuote(db, {
      ...input,
      organizationId,
      number,
      currency: CURRENCY,
      totals,
      createdBy: actor.id,
    });
    return { quoteId, number, total: totals.total };
  },
  summarize: (input) => `Quote "${input.title}" written`,
});

/** Rewrites a draft: once sent, a quote is what the client read. */
export const updateQuote = defineCommand({
  name: 'update-quote',
  input: quoteChange,
  reversibility: { reversible: false },
  async handler({ quoteId, ...input }, { db, organizationId }) {
    const quote = await findQuote(db, quoteId);
    if (!quote) throw new SalesRuleError('quote_not_found');
    if (quote.status !== 'draft') throw new SalesRuleError('quote_not_draft');
    const totals = totalsOf(input.lines, input.taxRate, quote.currency);
    await rewriteQuote(db, organizationId, quoteId, { ...input, totals });
    return { quoteId, total: totals.total };
  },
  summarize: ({ quoteId }) => `Quote ${quoteId} rewritten`,
});

export const sendQuote = defineCommand({
  name: 'send-quote',
  input: quoteRef,
  reversibility: { reversible: false },
  async handler({ quoteId }, { db }) {
    const quote = await findQuote(db, quoteId);
    if (!quote) throw new SalesRuleError('quote_not_found');
    await setQuoteStatus(db, quoteId, sent(quote.status));
    return { quoteId, status: 'sent' as const };
  },
  summarize: ({ quoteId }) => `Quote ${quoteId} sent`,
});

/**
 * The client said yes: the quote is won. Its project is opened at the center right after, with
 * the budget its lines give (`openWonProjects`) — here, only the fact that it is won.
 */
export const winQuote = defineCommand({
  name: 'win-quote',
  input: quoteRef,
  reversibility: { reversible: false },
  async handler({ quoteId }, { db, organizationId }) {
    const quote = await findQuote(db, quoteId);
    if (!quote) throw new SalesRuleError('quote_not_found');
    await setQuoteStatus(db, quoteId, closed(quote.status, 'won'));
    await announce(db, {
      type: 'quote.won',
      organization: organizationId,
      data: { quoteId, number: quote.number, total: quote.total, currency: quote.currency },
    });
    return { quoteId, status: 'won' as const };
  },
  summarize: ({ quoteId }) => `Quote ${quoteId} won`,
});

export const loseQuote = defineCommand({
  name: 'lose-quote',
  input: quoteRef,
  reversibility: { reversible: false },
  async handler({ quoteId }, { db }) {
    const quote = await findQuote(db, quoteId);
    if (!quote) throw new SalesRuleError('quote_not_found');
    await setQuoteStatus(db, quoteId, closed(quote.status, 'lost'));
    return { quoteId, status: 'lost' as const };
  },
  summarize: ({ quoteId }) => `Quote ${quoteId} lost`,
});

/**
 * The center opened the won quote's project: the quote, its invoices and what the register
 * already holds about them move to it. Run by the app once the center answered, never by a hand.
 */
export const attachProject = defineCommand({
  name: 'attach-project',
  input: quoteRef.extend({
    projectId: z.string().min(1).max(64),
    projectName: z.string().min(1).max(200),
  }),
  reversibility: { reversible: false },
  async handler({ quoteId, projectId, projectName }, { db }) {
    const quote = await findQuote(db, quoteId);
    if (!quote) throw new SalesRuleError('quote_not_found');
    if (quote.status !== 'won') throw new SalesRuleError('quote_not_won');
    const invoiceIds = await setQuoteProject(db, quoteId, { projectId, name: projectName });
    const keys: string[] = [];
    for (const invoiceId of invoiceIds) {
      const invoice = await findInvoice(db, invoiceId);
      keys.push(`invoice:${invoiceId}`);
      for (const receipt of invoice?.receipts ?? []) keys.push(`receipt:${receipt.receiptId}`);
    }
    await moveFacts(db, keys, projectId);
    return { quoteId, projectId };
  },
  summarize: ({ quoteId, projectId }) => `Quote ${quoteId} opened project ${projectId}`,
});
