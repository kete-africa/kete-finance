import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';

/** What a fact of money says (contract `money-fact.v1` of kete-core). */
export type FactKind = 'invoiced' | 'received' | 'committed' | 'spent';

/**
 * A fact of money, as Gestion holds it: said again under its key, it replaces what was said. An
 * invoice's amount is what is still due; a commitment's, what is still to pay.
 */
export interface Fact {
  key: string;
  kind: FactKind;
  /** In the currency's smallest unit: an integer, never negative. */
  amount: number;
  currency: string;
  /** The day it became true, `2026-10-13`. */
  occurredOn: string;
  label: string;
  projectId: string | null;
  /** The post of the project's budget it counts against, by its name. */
  post: string | null;
  partyId: string | null;
  href: string | null;
}

/** A fact that waits to be told to the center, or taken back there. */
export interface UntoldFact extends Fact {
  gone: boolean;
  /** When it last changed, as the database wrote it: what « told » is checked against. */
  changedAt: string;
}

/** The register of money, with its row-level security in the same migration. */
export function registerMigrationSql(options: { schema: string; appRole: string }): string {
  return `
create table ${options.schema}.money_register (
  organization_id text not null,
  fact_key text not null check (length(fact_key) between 1 and 200),
  kind text not null check (kind in ('invoiced', 'received', 'committed', 'spent')),
  amount bigint not null check (amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  occurred_on date not null,
  label text not null check (length(label) between 1 and 300),
  project_id text,
  post text,
  party_id text,
  href text,
  gone boolean not null default false,
  told_at timestamptz,
  changed_at timestamptz not null default now(),
  primary key (organization_id, fact_key)
);
create index money_register_untold on ${options.schema}.money_register (organization_id)
  where told_at is null;
create index money_register_project on ${options.schema}.money_register (organization_id, project_id);
${organizationPolicySql({ schema: options.schema, table: 'money_register', appRole: options.appRole })}
grant select, insert, update on ${options.schema}.money_register to ${options.appRole};
`;
}

type Row = {
  fact_key: string;
  kind: FactKind;
  amount: string;
  currency: string;
  occurred_on: string;
  label: string;
  project_id: string | null;
  post: string | null;
  party_id: string | null;
  href: string | null;
  gone: boolean;
  changed_at: string;
};

const columns = `fact_key, kind, amount, currency, to_char(occurred_on, 'YYYY-MM-DD') as occurred_on,
  label, project_id, post, party_id, href, gone, changed_at::text as changed_at`;

const toFact = (row: Row): UntoldFact => ({
  key: row.fact_key,
  kind: row.kind,
  amount: Number(row.amount),
  currency: row.currency,
  occurredOn: row.occurred_on,
  label: row.label,
  projectId: row.project_id,
  post: row.post,
  partyId: row.party_id,
  href: row.href,
  gone: row.gone,
  changedAt: row.changed_at,
});

/** Writes a fact in the register, in the caller's transaction; it then waits to be told. */
export async function sayFact(db: SqlExecutor, organizationId: string, fact: Fact): Promise<void> {
  await db.query(
    `insert into money_register
       (organization_id, fact_key, kind, amount, currency, occurred_on, label, project_id, post,
        party_id, href)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     on conflict (organization_id, fact_key) do update set
       kind = excluded.kind, amount = excluded.amount, currency = excluded.currency,
       occurred_on = excluded.occurred_on, label = excluded.label,
       project_id = excluded.project_id, post = excluded.post, party_id = excluded.party_id,
       href = excluded.href, gone = false, told_at = null, changed_at = clock_timestamp()`,
    [
      organizationId,
      fact.key,
      fact.kind,
      fact.amount,
      fact.currency,
      fact.occurredOn,
      fact.label,
      fact.projectId,
      fact.post,
      fact.partyId,
      fact.href,
    ],
  );
}

/** Takes a fact back: it was not true. It stays in the register, marked gone. */
export async function dropFact(db: SqlExecutor, key: string): Promise<void> {
  await db.query(
    `update money_register set gone = true, told_at = null, changed_at = clock_timestamp()
      where fact_key = $1 and not gone`,
    [key],
  );
}

/** Moves the facts of these keys to a project: it was just opened at the center. */
export async function moveFacts(
  db: SqlExecutor,
  keys: readonly string[],
  projectId: string,
): Promise<void> {
  if (keys.length === 0) return;
  await db.query(
    `update money_register set project_id = $2, told_at = null, changed_at = clock_timestamp()
      where fact_key = any($1::text[]) and project_id is distinct from $2`,
    [keys, projectId],
  );
}

export async function untoldFacts(db: SqlExecutor, limit = 200): Promise<UntoldFact[]> {
  const { rows } = await db.query<Row>(
    `select ${columns} from money_register where told_at is null order by changed_at limit $1`,
    [limit],
  );
  return rows.map(toFact);
}

/** Marks a fact told — unless it changed while it travelled: then it is told again. */
export async function markTold(db: SqlExecutor, fact: UntoldFact): Promise<void> {
  await db.query(
    `update money_register set told_at = now() where fact_key = $1 and changed_at::text = $2`,
    [fact.key, fact.changedAt],
  );
}

export async function countUntold(db: SqlExecutor): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `select count(*) as n from money_register where told_at is null`,
  );
  return Number(rows[0]?.n ?? 0);
}

/** What is engaged on a post of a project's budget: committed and still to pay, and spent. */
export async function engagedOn(db: SqlExecutor, projectId: string, post: string): Promise<number> {
  const { rows } = await db.query<{ total: string }>(
    `select coalesce(sum(amount), 0) as total from money_register
      where not gone and kind in ('committed', 'spent') and project_id = $1 and post = $2`,
    [projectId, post],
  );
  return Number(rows[0]?.total ?? 0);
}

/** The facts of the register that hold, the latest first. */
export async function listFacts(
  db: SqlExecutor,
  query: { projectId?: string; kind?: FactKind; limit?: number } = {},
): Promise<Fact[]> {
  const { rows } = await db.query<Row>(
    `select ${columns} from money_register
      where not gone
        and ($1::text is null or project_id = $1)
        and ($2::text is null or kind = $2)
      order by occurred_on desc, changed_at desc limit $3`,
    [query.projectId ?? null, query.kind ?? null, query.limit ?? 500],
  );
  return rows.map(toFact);
}
