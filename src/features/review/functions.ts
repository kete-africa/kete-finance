import type { DraftReview } from '@kete/capabilities';
import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { describeDraft } from '@kete/drafts';
import { z } from 'zod';
import { registry } from '@/platform/registry';
import { personOf } from '@/platform/session';
import { signedIn } from '@/platform/screen';
import { syncCenter } from '@/platform/sync';
import * as m from '@/paraglide/messages.js';
import { getLocale } from '@/paraglide/runtime.js';

/** A draft as the verification screen shows it: plain, serializable values. */
export interface ReviewScreen {
  draftId: string;
  description: string;
  autonomy: 3 | 4;
  status: 'prepared' | 'validated' | 'refused';
  fields: {
    key: string;
    title: string;
    value: string;
    source: string | null;
    uncertain: boolean;
  }[];
}

/** What a draft is, in her words: the capability's title, else its own description. */
const titles: Record<string, () => string> = {
  invoices_create: m.review_kind_invoice,
  invoices_from_quote: m.review_kind_invoice_from_quote,
  invoices_issue: m.review_kind_invoice_issue,
  invoices_discard: m.review_kind_invoice_discard,
  quotes_create: m.review_kind_quote,
  quotes_update: m.review_kind_quote_update,
  quotes_send: m.review_kind_quote_send,
  quotes_win: m.review_kind_quote_win,
  quotes_lose: m.review_kind_quote_lose,
  expenses_file: m.review_kind_expense,
  purchases_ask: m.review_kind_purchase,
  purchases_order: m.review_kind_purchase_order,
  purchases_pay: m.review_kind_purchase_pay,
  receipts_record: m.review_kind_receipt,
  advances_give: m.review_kind_advance,
  treasury_transfer: m.review_kind_transfer,
};

/** Each field's label, in her words (`lines.unitPrice` for a field of a line). */
const labels: Record<string, () => string> = {
  partyId: m.review_field_party,
  partyName: m.review_field_party,
  projectId: m.review_field_project,
  title: m.review_field_title,
  reference: m.review_field_reference,
  lines: m.review_field_lines,
  'lines.label': m.review_field_label,
  'lines.quantity': m.review_field_quantity,
  'lines.unitPrice': m.review_field_unit_price,
  'lines.taxRate': m.review_field_tax_rate,
  'lines.post': m.review_field_post,
  dueOn: m.review_field_due_on,
  validUntil: m.review_field_valid_until,
  spentOn: m.review_field_spent_on,
  receivedOn: m.review_field_received_on,
  paidOn: m.review_field_paid_on,
  method: m.review_field_method,
  purpose: m.review_field_purpose,
  reason: m.review_field_reason,
  quoteId: m.review_field_quote,
  invoiceId: m.review_field_invoice,
  amount: m.review_field_amount,
  label: m.review_field_label,
  post: m.review_field_post,
};

/** A draft as a person reads it (kete-core spec 139): labels, F CFA, dates, names — never raw. */
function toScreen(review: DraftReview, names: Map<string, string>): ReviewScreen {
  return {
    draftId: review.draftId,
    description: titles[review.capability]?.() ?? review.description,
    autonomy: review.autonomy,
    status: review.status,
    fields: describeDraft(review, {
      locale: getLocale(),
      label: (path) => labels[path]?.(),
      name: (id) => names.get(id),
      words: { yes: m.review_yes(), no: m.review_no() },
    })
      // A reference whose name is said beside it: once, by its name.
      .filter((field) => !(field.key.endsWith('Id') && `${field.key.slice(0, -2)}Name` in review.values))
      .map((field) => ({
      key: field.key,
      title: field.label,
      value: field.value,
      source: field.source,
      uncertain: field.uncertain,
    })),
  };
}

/**
 * The names a draft carries beside its references (`partyName` beside `partyId`): a reference is
 * shown by its name, and the reference itself is not shown twice.
 */
function namesIn(review: DraftReview): Map<string, string> {
  const names = new Map<string, string>();
  const walk = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    for (const [key, id] of Object.entries(record)) {
      const name = record[key.replace(/Id$/, 'Name')];
      if (key.endsWith('Id') && typeof id === 'string' && typeof name === 'string') {
        names.set(id, name);
      }
      walk(id);
    }
  };
  walk(review.values);
  return names;
}

export const fetchPerson = createServerFn({ method: 'GET' }).handler(async () => {
  const identity = await personOf(getRequest());
  return identity ? { name: identity.name, organizationId: identity.organizationId } : null;
});

/** A draft an agent prepared, as the person sees it before deciding. */
export const fetchReview = createServerFn({ method: 'GET' })
  .validator((input: unknown) => z.object({ draftId: z.string().min(1).max(128) }).parse(input))
  .handler(async ({ data }) => {
    const { caller, as } = await signedIn();
    const review = await as(() => registry.review(caller, data.draftId));
    return review ? toScreen(review, namesIn(review)) : null;
  });

/** The person decides; level 4 arrives here already confirmed by the screen's dialog. */
export const decideReview = createServerFn({ method: 'POST' })
  .validator((input: unknown) =>
    z
      .discriminatedUnion('action', [
        z.object({
          action: z.literal('validate'),
          draftId: z.string().min(1).max(128),
          confirmed: z.boolean(),
        }),
        z.object({
          action: z.literal('refuse'),
          draftId: z.string().min(1).max(128),
          reason: z.string().trim().min(1).max(1000),
        }),
      ])
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { caller, as, token } = await signedIn();
    const decided = await as(() =>
      data.action === 'validate'
        ? registry.decide({
            ...caller,
            draftId: data.draftId,
            action: 'validate',
            confirmed: data.confirmed,
          })
        : registry.decide({
            ...caller,
            draftId: data.draftId,
            action: 'refuse',
            reason: data.reason,
          }),
    );
    // What she validated may have won a quote or said a fact: the center hears of it.
    if (data.action === 'validate') await syncCenter(token, caller);
    return { status: decided.status };
  });
