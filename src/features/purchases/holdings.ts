import type { AppHolding } from '@kete/center';
import type { SqlExecutor } from '@kete/tenancy';
import { linkOf } from '@/features/register';
import * as m from '@/paraglide/messages.js';

// What purchases hold, as the center keeps it (kete-core spec 114): a request sent back is its
// requester's to correct; one decided here waits on who the policies name to approve it; an
// approved purchase is its requester's to order; an advance not yet justified, its holder's.
// A request the center's circuit decides is already a holding there: it is not said twice.

const on = (projectId: string | null, kind: string, id: string) =>
  projectId ? { kind: 'project', id: projectId } : { kind, id };

export async function purchaseHoldings(db: SqlExecutor): Promise<AppHolding[]> {
  const { rows: requests } = await db.query<{
    request_id: string;
    number: string;
    title: string;
    requester_id: string;
    project_id: string | null;
    status: 'asked' | 'returned' | 'approved';
    approver_id: string | null;
    created_at: Date;
  }>(
    `select request_id, number, title, requester_id, project_id, status, approver_id, created_at
       from purchase_requests
      where status = 'returned'
         or (status = 'asked' and route = 'here' and approver_id is not null)
         or (status = 'approved' and kind = 'purchase')
      order by created_at limit 500`,
  );
  const { rows: advances } = await db.query<{
    advance_id: string;
    number: string;
    purpose: string;
    holder_id: string;
    project_id: string | null;
    given_on: string;
    created_at: Date;
  }>(
    `select advance_id, number, purpose, holder_id, project_id,
            to_char(given_on, 'YYYY-MM-DD') as given_on, created_at
       from advances where status = 'open' and justified + returned < amount
      order by created_at limit 500`,
  );
  return [
    ...requests.map((r): AppHolding => {
      const words = { number: r.number, title: r.title };
      const toApprove = r.status === 'asked' && r.approver_id;
      return {
        kind: 'request',
        ref: r.request_id,
        object: on(r.project_id, 'request', r.request_id),
        what:
          r.status === 'returned'
            ? m.holding_request_returned(words)
            : toApprove
              ? m.holding_request_to_approve(words)
              : m.holding_request_to_order(words),
        holder: { kind: 'person', id: toApprove ? (r.approver_id as string) : r.requester_id },
        state: 'held',
        since: r.created_at.toISOString(),
        ...linkOf(`/achats/${r.request_id}`),
      };
    }),
    ...advances.map(
      (a): AppHolding => ({
        kind: 'advance',
        ref: a.advance_id,
        object: on(a.project_id, 'advance', a.advance_id),
        what: m.holding_advance_open({ number: a.number, purpose: a.purpose }),
        holder: { kind: 'person', id: a.holder_id },
        state: 'held',
        since: a.created_at.toISOString(),
        ...linkOf('/achats/avances'),
      }),
    ),
  ];
}
