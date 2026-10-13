import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import type { ReceiptMethod } from '@/features/sales/methods';
import type { RequestKind, RequestStatus, Route } from '../domain/purchases';
import type { Advance, PurchaseRequest } from '../purchase.record';

/** Whether a request's funders allowed it, or could not be asked (spec 004). */
export function agreementsMigrationSql(options: { schema: string }): string {
  return `
alter table ${options.schema}.purchase_requests
  add column agreement text check (agreement in ('allowed', 'unchecked'));
`;
}

/** Requests, their lines and payments, and advances — each with its row-level security. */
export function purchasesMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  const policy = (table: string) =>
    organizationPolicySql({ schema: s, table, appRole: options.appRole });
  return `
create table ${s}.advances (
  advance_id text primary key,
  organization_id text not null,
  number text not null,
  holder_id text not null,
  holder_name text not null,
  purpose text not null check (length(purpose) between 1 and 200),
  project_id text,
  project_name text,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount bigint not null check (amount > 0),
  justified bigint not null default 0 check (justified >= 0),
  returned bigint not null default 0 check (returned >= 0),
  given_on date not null,
  method text not null check (method in ('cash', 'bank', 'mobile', 'cheque')),
  reference text,
  status text not null default 'open' check (status in ('open', 'closed')),
  given_by text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, number),
  check (justified + returned <= amount)
);
create index advances_by_holder on ${s}.advances (organization_id, holder_id, status);
${policy('advances')}
grant select, insert, update on ${s}.advances to ${options.appRole};

create table ${s}.purchase_requests (
  request_id text primary key,
  organization_id text not null,
  number text not null,
  kind text not null check (kind in ('purchase', 'expense')),
  title text not null check (length(title) between 1 and 200),
  requester_id text not null,
  requester_name text not null,
  party_id text,
  party_name text,
  project_id text,
  project_name text,
  post text,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount bigint not null check (amount > 0),
  paid bigint not null default 0 check (paid >= 0 and paid <= amount),
  post_budget bigint,
  post_left bigint,
  beyond_by bigint not null default 0 check (beyond_by >= 0),
  status text not null default 'asked'
    check (status in ('asked', 'returned', 'approved', 'refused', 'ordered', 'paid', 'cancelled')),
  route text not null default 'waiting' check (route in ('waiting', 'center', 'here')),
  decision_request_id text,
  -- The subject it was first asked under: sent back and corrected, it is asked under it again.
  decision_subject text,
  decided_by text,
  decided_reason text,
  decided_at timestamptz,
  order_number text,
  spent_on date,
  proof text,
  advance_id text references ${s}.advances (advance_id),
  created_at timestamptz not null default now(),
  unique (organization_id, number),
  -- A request on a project names the post of its budget it counts against.
  check (project_id is null or post is not null)
);
create index purchase_requests_by_status on ${s}.purchase_requests (organization_id, status, created_at desc);
create index purchase_requests_by_requester on ${s}.purchase_requests (organization_id, requester_id);
create index purchase_requests_by_post on ${s}.purchase_requests (organization_id, project_id, post);
${policy('purchase_requests')}
grant select, insert, update on ${s}.purchase_requests to ${options.appRole};

create table ${s}.purchase_lines (
  organization_id text not null,
  request_id text not null references ${s}.purchase_requests (request_id) on delete cascade,
  position int not null,
  label text not null,
  quantity numeric(12, 3) not null check (quantity > 0),
  unit_price bigint not null check (unit_price >= 0),
  primary key (request_id, position)
);
create index purchase_lines_by_label on ${s}.purchase_lines (organization_id, lower(label));
${policy('purchase_lines')}
grant select, insert, delete on ${s}.purchase_lines to ${options.appRole};

create table ${s}.purchase_payments (
  payment_id text primary key,
  organization_id text not null,
  request_id text not null references ${s}.purchase_requests (request_id),
  amount bigint not null check (amount > 0),
  paid_on date not null,
  method text not null check (method in ('cash', 'bank', 'mobile', 'cheque')),
  reference text,
  recorded_by text not null,
  created_at timestamptz not null default now()
);
create index purchase_payments_by_request on ${s}.purchase_payments (request_id);
${policy('purchase_payments')}
grant select, insert on ${s}.purchase_payments to ${options.appRole};
`;
}

type RequestRow = {
  request_id: string;
  number: string;
  kind: RequestKind;
  title: string;
  requester_id: string;
  requester_name: string;
  party_id: string | null;
  party_name: string | null;
  project_id: string | null;
  project_name: string | null;
  post: string | null;
  currency: string;
  amount: string;
  paid: string;
  post_budget: string | null;
  post_left: string | null;
  beyond_by: string;
  status: RequestStatus;
  route: Route;
  decision_request_id: string | null;
  decision_subject: string | null;
  agreement: 'allowed' | 'unchecked' | null;
  decided_by: string | null;
  decided_reason: string | null;
  order_number: string | null;
  spent_on: string | null;
  proof: string | null;
  advance_id: string | null;
  asked_on: string;
};

const requestColumns = `request_id, number, kind, title, requester_id, requester_name, party_id,
  party_name, project_id, project_name, post, currency, amount, paid, post_budget, post_left,
  beyond_by, status, route, decision_request_id, decision_subject, agreement, decided_by, decided_reason, order_number,
  to_char(spent_on, 'YYYY-MM-DD') as spent_on, proof, advance_id,
  to_char(created_at, 'YYYY-MM-DD') as asked_on`;

const toRequest = (
  row: RequestRow,
  lines: PurchaseRequest['lines'] = [],
  payments: PurchaseRequest['payments'] = [],
): PurchaseRequest => ({
  requestId: row.request_id,
  number: row.number,
  kind: row.kind,
  title: row.title,
  requester: { userId: row.requester_id, name: row.requester_name },
  partyId: row.party_id,
  partyName: row.party_name,
  projectId: row.project_id,
  projectName: row.project_name,
  post: row.post,
  currency: row.currency,
  amount: Number(row.amount),
  paid: Number(row.paid),
  standing:
    row.post_budget === null
      ? null
      : {
          budget: Number(row.post_budget),
          left: Number(row.post_left ?? 0),
          beyondBy: Number(row.beyond_by),
        },
  status: row.status,
  route: row.route,
  decisionRequestId: row.decision_request_id,
  decisionSubject: row.decision_subject,
  agreement: row.agreement,
  decided: row.decided_by ? { by: row.decided_by, reason: row.decided_reason } : null,
  orderNumber: row.order_number,
  spentOn: row.spent_on,
  proof: row.proof,
  advanceId: row.advance_id,
  askedOn: row.asked_on,
  lines,
  payments,
});

export interface RequestWritten {
  title: string;
  partyId?: string | undefined;
  partyName?: string | undefined;
  projectId?: string | undefined;
  projectName?: string | null;
  post?: string | undefined;
  amount: number;
  standing: { budget: number; left: number; beyondBy: number } | null;
  /** What its funders said: allowed, not asked (unchecked), or no funder to ask (null). */
  agreement: 'allowed' | 'unchecked' | null;
  lines: PurchaseRequest['lines'];
}

async function writeLines(
  db: SqlExecutor,
  organizationId: string,
  requestId: string,
  lines: PurchaseRequest['lines'],
): Promise<void> {
  await db.query(`delete from purchase_lines where request_id = $1`, [requestId]);
  for (const [position, line] of lines.entries()) {
    await db.query(
      `insert into purchase_lines (organization_id, request_id, position, label, quantity, unit_price)
       values ($1, $2, $3, $4, $5, $6)`,
      [organizationId, requestId, position, line.label, line.quantity, line.unitPrice],
    );
  }
}

export async function insertRequest(
  db: SqlExecutor,
  request: RequestWritten & {
    organizationId: string;
    number: string;
    kind: RequestKind;
    requester: { userId: string; name: string };
    currency: string;
    spentOn?: string | undefined;
    proof?: string | undefined;
    advanceId?: string | undefined;
  },
): Promise<string> {
  const requestId = newId('pur');
  await db.query(
    `insert into purchase_requests
       (request_id, organization_id, number, kind, title, requester_id, requester_name, party_id,
        party_name, project_id, project_name, post, currency, amount, post_budget, post_left,
        beyond_by, spent_on, proof, advance_id, agreement)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
    [
      requestId,
      request.organizationId,
      request.number,
      request.kind,
      request.title,
      request.requester.userId,
      request.requester.name,
      request.partyId ?? null,
      request.partyName ?? null,
      request.projectId ?? null,
      request.projectName ?? null,
      request.post ?? null,
      request.currency,
      request.amount,
      request.standing?.budget ?? null,
      request.standing?.left ?? null,
      request.standing?.beyondBy ?? 0,
      request.spentOn ?? null,
      request.proof ?? null,
      request.advanceId ?? null,
      request.agreement,
    ],
  );
  await writeLines(db, request.organizationId, requestId, request.lines);
  return requestId;
}

/** A request corrected by who asked: it waits again, and its decision is asked again. */
export async function rewriteRequest(
  db: SqlExecutor,
  organizationId: string,
  requestId: string,
  request: RequestWritten,
): Promise<void> {
  await db.query(
    `update purchase_requests
        set title = $2, party_id = $3, party_name = $4, project_id = $5, project_name = $6,
            post = $7, amount = $8, post_budget = $9, post_left = $10, beyond_by = $11,
            agreement = $12, status = 'asked', route = 'waiting', decided_by = null, decided_reason = null,
            decided_at = null
      where request_id = $1`,
    [
      requestId,
      request.title,
      request.partyId ?? null,
      request.partyName ?? null,
      request.projectId ?? null,
      request.projectName ?? null,
      request.post ?? null,
      request.amount,
      request.standing?.budget ?? null,
      request.standing?.left ?? null,
      request.standing?.beyondBy ?? 0,
      request.agreement,
    ],
  );
  await writeLines(db, organizationId, requestId, request.lines);
}

export async function findRequest(
  db: SqlExecutor,
  requestId: string,
): Promise<PurchaseRequest | null> {
  const { rows } = await db.query<RequestRow>(
    `select ${requestColumns} from purchase_requests where request_id = $1`,
    [requestId],
  );
  if (!rows[0]) return null;
  const lines = await db.query<{ label: string; quantity: string; unit_price: string }>(
    `select label, quantity, unit_price from purchase_lines where request_id = $1 order by position`,
    [requestId],
  );
  const payments = await db.query<{
    payment_id: string;
    amount: string;
    paid_on: string;
    method: ReceiptMethod;
    reference: string | null;
  }>(
    `select payment_id, amount, to_char(paid_on, 'YYYY-MM-DD') as paid_on, method, reference
       from purchase_payments where request_id = $1 order by paid_on, created_at`,
    [requestId],
  );
  return toRequest(
    rows[0],
    lines.rows.map((line) => ({
      label: line.label,
      quantity: Number(line.quantity),
      unitPrice: Number(line.unit_price),
    })),
    payments.rows.map((payment) => ({
      paymentId: payment.payment_id,
      amount: Number(payment.amount),
      paidOn: payment.paid_on,
      method: payment.method,
      reference: payment.reference,
    })),
  );
}

/**
 * Requests, the latest first: all of them, or only hers (`requesterId`) for who does not read
 * every purchase. What `purchase_list` returns.
 */
export async function searchRequests(
  db: SqlExecutor,
  query: {
    text?: string | undefined;
    requesterId?: string | undefined;
    statuses?: readonly RequestStatus[] | undefined;
    route?: Route | undefined;
    limit: number;
  },
): Promise<PurchaseRequest[]> {
  const { rows } = await db.query<RequestRow>(
    `select ${requestColumns} from purchase_requests
      where ($1::text is null or title ilike '%' || $1 || '%' or number ilike '%' || $1 || '%'
             or coalesce(party_name, '') ilike '%' || $1 || '%')
        and ($2::text is null or requester_id = $2)
        and ($3::text[] is null or status = any($3::text[]))
        and ($4::text is null or route = $4)
      order by created_at desc, request_id limit $5`,
    [
      query.text ?? null,
      query.requesterId ?? null,
      query.statuses ? [...query.statuses] : null,
      query.route ?? null,
      query.limit,
    ],
  );
  return rows.map((row) => toRequest(row));
}

/** What is asked on a post and still waits for its decision, the request itself left out. */
export async function waitingOn(
  db: SqlExecutor,
  projectId: string,
  post: string,
  except?: string,
): Promise<number> {
  const { rows } = await db.query<{ total: string }>(
    `select coalesce(sum(amount), 0) as total from purchase_requests
      where project_id = $1 and post = $2 and status in ('asked', 'returned')
        and ($3::text is null or request_id <> $3)`,
    [projectId, post, except ?? null],
  );
  return Number(rows[0]?.total ?? 0);
}

/** Her requests the center has not been asked about yet. */
export async function requestsToRoute(
  db: SqlExecutor,
  requesterId: string,
  limit = 20,
): Promise<PurchaseRequest[]> {
  return searchRequests(db, { requesterId, statuses: ['asked'], route: 'waiting', limit });
}

export async function setRoute(
  db: SqlExecutor,
  requestId: string,
  route: Route,
  decision: { requestId: string; subject: string } | null,
): Promise<void> {
  await db.query(
    `update purchase_requests
        set route = $2, decision_request_id = coalesce($3, decision_request_id),
            decision_subject = coalesce($4, decision_subject)
      where request_id = $1 and status = 'asked'`,
    [requestId, route, decision?.requestId ?? null, decision?.subject ?? null],
  );
}

export async function setDecided(
  db: SqlExecutor,
  requestId: string,
  status: Extract<RequestStatus, 'approved' | 'refused' | 'returned' | 'paid'>,
  decided: { by: string; reason?: string | undefined },
): Promise<void> {
  await db.query(
    `update purchase_requests
        set status = $2, decided_by = $3, decided_reason = $4, decided_at = now(),
            paid = case when $2 = 'paid' then amount else paid end
      where request_id = $1`,
    [requestId, status, decided.by, decided.reason ?? null],
  );
}

export async function setOrdered(
  db: SqlExecutor,
  requestId: string,
  order: { number: string; partyId?: string | undefined; partyName: string },
): Promise<void> {
  await db.query(
    `update purchase_requests
        set status = 'ordered', order_number = $2, party_id = coalesce($3, party_id), party_name = $4
      where request_id = $1`,
    [requestId, order.number, order.partyId ?? null, order.partyName],
  );
}

export async function insertPayment(
  db: SqlExecutor,
  payment: {
    organizationId: string;
    requestId: string;
    amount: number;
    paidOn: string;
    method: ReceiptMethod;
    reference?: string | undefined;
    recordedBy: string;
    settles: boolean;
  },
): Promise<string> {
  const paymentId = newId('pay');
  await db.query(
    `insert into purchase_payments
       (payment_id, organization_id, request_id, amount, paid_on, method, reference, recorded_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      paymentId,
      payment.organizationId,
      payment.requestId,
      payment.amount,
      payment.paidOn,
      payment.method,
      payment.reference ?? null,
      payment.recordedBy,
    ],
  );
  await db.query(
    `update purchase_requests
        set paid = paid + $2, status = case when $3 then 'paid' else status end
      where request_id = $1`,
    [payment.requestId, payment.amount, payment.settles],
  );
  return paymentId;
}

type AdvanceRow = {
  advance_id: string;
  number: string;
  holder_id: string;
  holder_name: string;
  purpose: string;
  project_id: string | null;
  project_name: string | null;
  currency: string;
  amount: string;
  justified: string;
  returned: string;
  given_on: string;
  method: ReceiptMethod;
  status: 'open' | 'closed';
};

const advanceColumns = `advance_id, number, holder_id, holder_name, purpose, project_id, project_name,
  currency, amount, justified, returned, to_char(given_on, 'YYYY-MM-DD') as given_on, method, status`;

const toAdvance = (row: AdvanceRow): Advance => ({
  advanceId: row.advance_id,
  number: row.number,
  holder: { userId: row.holder_id, name: row.holder_name },
  purpose: row.purpose,
  projectId: row.project_id,
  projectName: row.project_name,
  currency: row.currency,
  amount: Number(row.amount),
  justified: Number(row.justified),
  returned: Number(row.returned),
  givenOn: row.given_on,
  method: row.method,
  status: row.status,
});

export async function insertAdvance(
  db: SqlExecutor,
  advance: {
    organizationId: string;
    number: string;
    holder: { userId: string; name: string };
    purpose: string;
    projectId?: string | undefined;
    projectName?: string | null;
    currency: string;
    amount: number;
    givenOn: string;
    method: ReceiptMethod;
    reference?: string | undefined;
    givenBy: string;
  },
): Promise<string> {
  const advanceId = newId('adv');
  await db.query(
    `insert into advances
       (advance_id, organization_id, number, holder_id, holder_name, purpose, project_id,
        project_name, currency, amount, given_on, method, reference, given_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      advanceId,
      advance.organizationId,
      advance.number,
      advance.holder.userId,
      advance.holder.name,
      advance.purpose,
      advance.projectId ?? null,
      advance.projectName ?? null,
      advance.currency,
      advance.amount,
      advance.givenOn,
      advance.method,
      advance.reference ?? null,
      advance.givenBy,
    ],
  );
  return advanceId;
}

export async function findAdvance(db: SqlExecutor, advanceId: string): Promise<Advance | null> {
  const { rows } = await db.query<AdvanceRow>(
    `select ${advanceColumns} from advances where advance_id = $1`,
    [advanceId],
  );
  return rows[0] ? toAdvance(rows[0]) : null;
}

export async function listAdvances(
  db: SqlExecutor,
  query: { holderId?: string | undefined; open?: boolean; limit?: number } = {},
): Promise<Advance[]> {
  const { rows } = await db.query<AdvanceRow>(
    `select ${advanceColumns} from advances
      where ($1::text is null or holder_id = $1) and (not $2::boolean or status = 'open')
      order by status, given_on desc, advance_id limit $3`,
    [query.holderId ?? null, query.open ?? false, query.limit ?? 200],
  );
  return rows.map(toAdvance);
}

/** Takes `amount` off what an advance's holder still owes: justified by a note, or brought back. */
export async function settleAdvance(
  db: SqlExecutor,
  advanceId: string,
  by: 'justified' | 'returned',
  amount: number,
): Promise<Advance> {
  const { rows } = await db.query<AdvanceRow>(
    `update advances
        set ${by} = ${by} + $2,
            status = case when justified + returned + $2 >= amount then 'closed' else 'open' end
      where advance_id = $1 returning ${advanceColumns}`,
    [advanceId, amount],
  );
  return toAdvance(rows[0] as AdvanceRow);
}

/**
 * The memory of prices: what a thing was last bought for, and from whom — from the requests that
 * were approved, the latest first.
 */
export async function pricesOf(
  db: SqlExecutor,
  text: string,
  limit = 5,
): Promise<{ label: string; unitPrice: number; supplier: string | null; on: string; currency: string }[]> {
  const { rows } = await db.query<{
    label: string;
    unit_price: string;
    party_name: string | null;
    asked_on: string;
    currency: string;
  }>(
    `select l.label, l.unit_price, r.party_name, to_char(r.created_at, 'YYYY-MM-DD') as asked_on,
            r.currency
       from purchase_lines l join purchase_requests r on r.request_id = l.request_id
      where r.kind = 'purchase' and r.status in ('approved', 'ordered', 'paid')
        and l.label ilike '%' || $1 || '%'
      order by r.created_at desc, l.position limit $2`,
    [text, limit],
  );
  return rows.map((row) => ({
    label: row.label,
    unitPrice: Number(row.unit_price),
    supplier: row.party_name,
    on: row.asked_on,
    currency: row.currency,
  }));
}

/** What purchases stand at: the figures of the home screen, computed here. */
export async function purchasesStanding(
  db: SqlExecutor,
  requesterId?: string,
): Promise<{ waiting: number; toOrder: number; toPay: number; advances: number }> {
  const { rows } = await db.query<{
    waiting: string;
    to_order: string;
    to_pay: string;
    advances: string;
  }>(
    `select
       (select coalesce(sum(amount), 0) from purchase_requests
         where status in ('asked', 'returned') and ($1::text is null or requester_id = $1)) as waiting,
       (select coalesce(sum(amount), 0) from purchase_requests
         where status = 'approved' and kind = 'purchase'
           and ($1::text is null or requester_id = $1)) as to_order,
       (select coalesce(sum(amount - paid), 0) from purchase_requests
         where status in ('approved', 'ordered') and ($1::text is null or requester_id = $1)) as to_pay,
       (select coalesce(sum(amount - justified - returned), 0) from advances
         where status = 'open' and ($1::text is null or holder_id = $1)) as advances`,
    [requesterId ?? null],
  );
  const row = rows[0];
  return {
    waiting: Number(row?.waiting ?? 0),
    toOrder: Number(row?.to_order ?? 0),
    toPay: Number(row?.to_pay ?? 0),
    advances: Number(row?.advances ?? 0),
  };
}

/** The request the center decides under this identifier of its own. */
export async function requestOfDecision(
  db: SqlExecutor,
  decisionRequestId: string,
): Promise<string | null> {
  const { rows } = await db.query<{ request_id: string }>(
    `select request_id from purchase_requests where decision_request_id = $1`,
    [decisionRequestId],
  );
  return rows[0]?.request_id ?? null;
}

/** Who already asked or held something here, by name: whom an advance may be given to. */
export async function knownPeople(db: SqlExecutor): Promise<{ userId: string; name: string }[]> {
  const { rows } = await db.query<{ user_id: string; name: string }>(
    `select user_id, max(name) as name from (
       select requester_id as user_id, requester_name as name from purchase_requests
       union all
       select holder_id, holder_name from advances
     ) known group by user_id order by 2, 1 limit 200`,
  );
  return rows.map((row) => ({ userId: row.user_id, name: row.name }));
}

/**
 * The projects this app already knows, by what was asked or given on them: who pays is rarely of
 * a project's team, and still gives an advance on it.
 */
export async function knownProjects(
  db: SqlExecutor,
): Promise<{ projectId: string; name: string }[]> {
  const { rows } = await db.query<{ project_id: string; name: string }>(
    `select project_id, max(project_name) as name from (
       select project_id, project_name from purchase_requests where project_id is not null
       union all
       select project_id, project_name from advances where project_id is not null
       union all
       select project_id, project_name from quotes where project_id is not null
     ) known where project_name is not null group by project_id order by 2, 1 limit 200`,
  );
  return rows.map((row) => ({ projectId: row.project_id, name: row.name }));
}
