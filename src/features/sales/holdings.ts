import type { AppHolding } from '@kete/center';
import type { SqlExecutor } from '@kete/tenancy';
import * as m from '@/paraglide/messages.js';
import { linkOf } from '@/features/register';

// What sales hold, as the center keeps it (kete-core spec 114): a quote sent waits on its client,
// held by who wrote it; an issued invoice not yet paid waits on its client until its due day.

const on = (projectId: string | null, partyId: string | null, fallback: { kind: string; id: string }) =>
  projectId
    ? { kind: 'project', id: projectId }
    : partyId
      ? { kind: 'party', id: partyId }
      : fallback;

export async function salesHoldings(db: SqlExecutor): Promise<AppHolding[]> {
  const { rows: quotes } = await db.query<{
    quote_id: string;
    number: string;
    title: string;
    party_id: string | null;
    party_name: string;
    project_id: string | null;
    valid_until: string | null;
    created_by: string;
    created_at: Date;
  }>(
    `select quote_id, number, title, party_id, party_name, project_id,
            to_char(valid_until, 'YYYY-MM-DD') as valid_until, created_by, created_at
       from quotes where status = 'sent' order by created_at limit 500`,
  );
  const { rows: invoices } = await db.query<{
    invoice_id: string;
    number: string;
    party_id: string | null;
    party_name: string;
    project_id: string | null;
    due_on: string | null;
    created_by: string;
    created_at: Date;
  }>(
    `select invoice_id, number, party_id, party_name, project_id,
            to_char(due_on, 'YYYY-MM-DD') as due_on, created_by, created_at
       from invoices where status = 'issued' and received < total order by created_at limit 500`,
  );
  return [
    ...quotes.map(
      (q): AppHolding => ({
        kind: 'quote',
        ref: q.quote_id,
        object: on(q.project_id, q.party_id, { kind: 'quote', id: q.quote_id }),
        what: m.holding_quote_sent({ number: q.number, party: q.party_name }),
        holder: { kind: 'person', id: q.created_by },
        ...(q.party_id
          ? { state: 'waiting', waitingOn: { kind: 'party', id: q.party_id } }
          : { state: 'held' }),
        since: q.created_at.toISOString(),
        ...(q.valid_until ? { due: q.valid_until } : {}),
        ...linkOf(`/ventes/devis/${q.quote_id}`),
      }),
    ),
    ...invoices.map(
      (i): AppHolding => ({
        kind: 'invoice',
        ref: i.invoice_id,
        object: on(i.project_id, i.party_id, { kind: 'invoice', id: i.invoice_id }),
        what: m.holding_invoice_due({ number: i.number, party: i.party_name }),
        holder: { kind: 'person', id: i.created_by },
        ...(i.party_id
          ? { state: 'waiting', waitingOn: { kind: 'party', id: i.party_id } }
          : { state: 'held' }),
        since: i.created_at.toISOString(),
        ...(i.due_on ? { due: i.due_on } : {}),
        ...linkOf(`/ventes/factures/${i.invoice_id}`),
      }),
    ),
  ];
}

