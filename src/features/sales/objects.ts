import type { AppObject } from '@kete/center';
import type { SqlExecutor } from '@kete/tenancy';
import * as m from '@/paraglide/messages.js';
import { linkOf } from '@/features/register';

// Sales in the center's index (spec 007; kete-core spec 142; doctrine D-062, R1, R15): each quote
// and invoice said with its title, its state, its project, its third party and who answers for
// it, so that « # », the search, Kete and the agents of the center find them with each person's
// own rights. Their data stays here. The kinds are declared in the manifest (`kete.json`).

/** The quotes and invoices still in progress, and those that changed in the last month. */
export async function salesObjects(db: SqlExecutor): Promise<AppObject[]> {
  const { rows: quotes } = await db.query<{
    quote_id: string;
    number: string;
    party_id: string | null;
    party_name: string;
    project_id: string | null;
    status: string;
    created_by: string;
    created_at: Date;
  }>(
    `select quote_id, number, party_id, party_name, project_id, status, created_by, created_at
       from quotes
      where status in ('draft', 'sent') or created_at > now() - interval '30 days'
      order by created_at desc limit 150`,
  );
  const { rows: invoices } = await db.query<{
    invoice_id: string;
    number: string | null;
    quote_id: string | null;
    party_id: string | null;
    party_name: string;
    project_id: string | null;
    status: string;
    paid: boolean;
    created_by: string;
    changed_at: Date;
  }>(
    `select invoice_id, number, quote_id, party_id, party_name, project_id, status,
            (status = 'issued' and received >= total) as paid, created_by,
            greatest(created_at, issued_on::timestamptz) as changed_at
       from invoices
      where status = 'draft' or received < total or created_at > now() - interval '30 days'
      order by created_at desc limit 200`,
  );
  return [
    ...quotes.map((q): AppObject => ({
      kind: 'quote',
      id: q.quote_id,
      title: m.object_quote({ number: q.number, party: q.party_name }),
      state: q.status,
      ...(q.project_id ? { projectId: q.project_id } : {}),
      ...(q.party_id ? { partyId: q.party_id } : {}),
      personId: q.created_by,
      ...linkOf(`/ventes/devis/${q.quote_id}`),
      updatedAt: q.created_at.toISOString(),
    })),
    ...invoices.map((i): AppObject => ({
      kind: 'invoice',
      id: i.invoice_id,
      title: i.number
        ? m.object_invoice({ number: i.number, party: i.party_name })
        : m.object_invoice_draft({ party: i.party_name }),
      state: i.paid ? 'paid' : i.status,
      ...(i.project_id ? { projectId: i.project_id } : {}),
      ...(i.party_id ? { partyId: i.party_id } : {}),
      personId: i.created_by,
      ...(i.quote_id ? { links: [{ relation: 'bills', kind: 'quote', id: i.quote_id }] } : {}),
      ...linkOf(`/ventes/factures/${i.invoice_id}`),
      updatedAt: i.changed_at.toISOString(),
    })),
  ];
}
