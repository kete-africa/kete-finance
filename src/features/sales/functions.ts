import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { countUntold, currencyIn } from '@/features/register';
import * as m from '@/paraglide/messages.js';
import { getCenter } from '@/platform/center';
import { transaction } from '@/platform/db';
import { holds } from '@/platform/rights';
import { perform, ScreenError, signedIn } from '@/platform/screen';
import { syncCenter } from '@/platform/sync';
import {
  findInvoice,
  findQuote,
  invoicesOfQuote,
  salesStanding,
  searchInvoices,
  searchQuotes,
  wonNotInvoiced,
} from './infrastructure/sales.table';
import {
  directInvoiceInput,
  invoiceRef,
  quoteChange,
  quoteInput,
  quoteRef,
  receiptInput,
} from './quote.record';

// The screens of sales: each reads under `sales:read`, and each gesture is the capability an agent
// would only prepare a draft of. A refusal or a broken rule comes back as its code.

/** What a gesture answers a screen. */
const answer = <T>(outcome: { ok: true; output: T } | { ok: false; code: string }) =>
  outcome.ok
    ? { ok: true as const, output: outcome.output }
    : { ok: false as const, code: outcome.code };

async function reading<T>(work: (organizationId: string) => Promise<T>): Promise<T> {
  const { caller, as } = await signedIn();
  return as(async () => {
    if (!holds('sales:read')) throw new ScreenError('forbidden');
    return work(caller.organizationId);
  });
}

/** What she may do here: the screens show a gesture only to who may make it. */
const may = () => ({
  write: holds('sales:write'),
  issue: holds('sales:issue'),
  collect: holds('sales:collect'),
});

export const fetchSalesHome = createServerFn({ method: 'GET' }).handler(() =>
  reading((organizationId) =>
    transaction(organizationId, async (db) => ({
      currency: await currencyIn(db, organizationId),
      standing: await salesStanding(db),
      toInvoice: await wonNotInvoiced(db),
      due: await searchInvoices(db, { due: true, limit: 50 }),
      // Facts the center has not heard yet, and whether there is a center to hear them.
      waiting: await countUntold(db),
      connected: getCenter().connected,
      may: may(),
    })),
  ),
);

export const fetchQuotes = createServerFn({ method: 'GET' }).handler(() =>
  reading((organizationId) =>
    transaction(organizationId, async (db) => ({
      quotes: await searchQuotes(db, { limit: 200 }),
      may: may(),
    })),
  ),
);

export const fetchQuote = createServerFn({ method: 'GET' })
  .validator((input: unknown) => quoteRef.parse(input))
  .handler(({ data }) =>
    reading((organizationId) =>
      transaction(organizationId, async (db) => ({
        quote: await findQuote(db, data.quoteId),
        invoices: await invoicesOfQuote(db, data.quoteId),
        connected: getCenter().connected,
        may: may(),
      })),
    ),
  );

export const fetchInvoices = createServerFn({ method: 'GET' }).handler(() =>
  reading((organizationId) =>
    transaction(organizationId, async (db) => ({
      invoices: await searchInvoices(db, { limit: 200 }),
      may: may(),
    })),
  ),
);

export const fetchInvoice = createServerFn({ method: 'GET' })
  .validator((input: unknown) => invoiceRef.parse(input))
  .handler(({ data }) =>
    reading((organizationId) =>
      transaction(organizationId, async (db) => ({
        invoice: await findInvoice(db, data.invoiceId),
        may: may(),
      })),
    ),
  );

/** What a new document starts from: the currency, and whether the center gives its references. */
export const fetchSalesSetting = createServerFn({ method: 'GET' }).handler(() =>
  reading(async (organizationId) => ({
    currency: await transaction(organizationId, (db) => currencyIn(db, organizationId)),
    connected: getCenter().connected,
  })),
);

/** The third parties of the center matching a few letters: a client is picked, never retyped. */
export const searchParties = createServerFn({ method: 'GET' })
  .validator((input: unknown) => z.object({ text: z.string().trim().max(80) }).parse(input))
  .handler(async ({ data }) => {
    const { as, token } = await signedIn();
    return as(async () => {
      if (!holds('sales:write')) throw new ScreenError('forbidden');
      const parties = await getCenter().parties(token, data.text || undefined);
      return parties.slice(0, 12).map((party) => ({ partyId: party.partyId, name: party.name }));
    });
  });

/** The projects of the center she belongs to: an invoice without a quote names its project. */
export const fetchMyProjects = createServerFn({ method: 'GET' }).handler(async () => {
  const { as, token } = await signedIn();
  return as(async () => {
    if (!holds('sales:write')) throw new ScreenError('forbidden');
    const projects = await getCenter().projects(token);
    return projects
      .filter((project) => project.status === 'open')
      .map((project) => ({ projectId: project.projectId, name: project.name }));
  });
});

export const saveQuote = createServerFn({ method: 'POST' })
  .validator((input: unknown) => quoteInput.extend({ quoteId: z.string().optional() }).parse(input))
  .handler(async ({ data }) => {
    const { quoteId, ...quote } = data;
    return quoteId
      ? answer(
          await perform<{ quoteId: string }>('quotes_update', quoteChange.parse({ quoteId, ...quote })),
        )
      : answer(await perform<{ quoteId: string }>('quotes_create', quote));
  });

export const moveQuote = createServerFn({ method: 'POST' })
  .validator((input: unknown) =>
    quoteRef.extend({ to: z.enum(['send', 'win', 'lose']) }).parse(input),
  )
  .handler(async ({ data }) =>
    answer(await perform<{ quoteId: string }>(`quotes_${data.to}`, { quoteId: data.quoteId })),
  );

/** Asks the center again for what it has not taken: a won quote's project, the waiting facts. */
export const tellCenterNow = createServerFn({ method: 'POST' }).handler(async () => {
  const { caller, token } = await signedIn();
  return syncCenter(token, caller);
});

export const invoiceShare = createServerFn({ method: 'POST' })
  .validator((input: unknown) =>
    quoteRef
      .extend({ share: z.number().positive().max(100), dueOn: z.iso.date().optional() })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const quote = await reading((organizationId) =>
      transaction(organizationId, (db) => findQuote(db, data.quoteId)),
    );
    if (!quote) return { ok: false as const, code: 'quote_not_found' };
    return answer(
      await perform<{ invoiceId: string }>('invoices_from_quote', {
        ...data,
        // The invoice's line, in the words of who asks: « 30 % du devis D-2026-0001 ».
        label: m.invoice_share_label({ share: String(data.share), number: quote.number }),
      }),
    );
  });

export const addInvoice = createServerFn({ method: 'POST' })
  .validator((input: unknown) => directInvoiceInput.parse(input))
  .handler(async ({ data }) =>
    answer(await perform<{ invoiceId: string }>('invoices_create', data)),
  );

export const moveInvoice = createServerFn({ method: 'POST' })
  .validator((input: unknown) => invoiceRef.extend({ to: z.enum(['issue', 'discard']) }).parse(input))
  .handler(async ({ data }) =>
    answer(
      await perform<{ invoiceId: string }>(`invoices_${data.to}`, { invoiceId: data.invoiceId }),
    ),
  );

export const addReceipt = createServerFn({ method: 'POST' })
  .validator((input: unknown) => receiptInput.parse(input))
  .handler(async ({ data }) =>
    answer(await perform<{ receiptId: string; due: number }>('receipts_record', data)),
  );
