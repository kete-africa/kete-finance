import type { AppObject } from '@kete/center';
import type { SqlExecutor } from '@kete/tenancy';
import * as m from '@/paraglide/messages.js';
import { linkOf } from '@/features/register';

// Purchases and expenses in the center's index (spec 007; kete-core spec 142; doctrine D-062, R1,
// R15): each request said with its title, its state, its project, its supplier and who asked it,
// found and cited at the center with each person's own rights. Its data stays here.

/** The requests still in progress, and those that changed in the last month. */
export async function purchaseObjects(db: SqlExecutor): Promise<AppObject[]> {
  const { rows } = await db.query<{
    request_id: string;
    number: string;
    title: string;
    party_id: string | null;
    project_id: string | null;
    status: string;
    requester_id: string;
    changed_at: Date;
  }>(
    `select request_id, number, title, party_id, project_id, status, requester_id,
            greatest(created_at, decided_at) as changed_at
       from purchase_requests
      where status in ('asked', 'returned', 'approved', 'ordered')
         or greatest(created_at, decided_at) > now() - interval '30 days'
      order by created_at desc limit 150`,
  );
  return rows.map((r): AppObject => ({
    kind: 'purchase',
    id: r.request_id,
    title: m.object_purchase({ number: r.number, title: r.title }),
    state: r.status,
    ...(r.project_id ? { projectId: r.project_id } : {}),
    ...(r.party_id ? { partyId: r.party_id } : {}),
    personId: r.requester_id,
    ...linkOf(`/achats/${r.request_id}`),
    updatedAt: r.changed_at.toISOString(),
  }));
}
