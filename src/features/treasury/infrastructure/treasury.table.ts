import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import {
  kindOfMethod,
  leaving,
  TreasuryRuleError,
  type AccountKind,
  type Method,
} from '../domain/treasury';
import type { Account, Closing, Movement } from '../treasury.record';

/** Accounts, their movements and the tills' closings — each with its row-level security. */
export function treasuryMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  const policy = (table: string) =>
    organizationPolicySql({ schema: s, table, appRole: options.appRole });
  return `
create table ${s}.accounts (
  account_id text primary key,
  organization_id text not null,
  name text not null check (length(name) between 1 and 120),
  kind text not null check (kind in ('bank', 'till', 'mobile')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  opening bigint not null default 0,
  opened_on date not null,
  active boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);
${policy('accounts')}
grant select, insert, update on ${s}.accounts to ${options.appRole};

create table ${s}.account_movements (
  movement_id text primary key,
  organization_id text not null,
  -- Null while no account takes this way of paying: it waits to be assigned.
  account_id text references ${s}.accounts (account_id),
  direction text not null check (direction in ('in', 'out')),
  amount bigint not null check (amount > 0),
  occurred_on date not null,
  method text not null check (method in ('cash', 'bank', 'mobile', 'cheque')),
  label text not null check (length(label) between 1 and 300),
  -- What it comes from: a receipt, a payment, an advance, a transfer; null for one typed by hand.
  source text,
  project_id text,
  recorded_by text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, source)
);
create index account_movements_by_account on ${s}.account_movements (account_id, occurred_on);
create index account_movements_unassigned on ${s}.account_movements (organization_id)
  where account_id is null;
${policy('account_movements')}
grant select, insert, update on ${s}.account_movements to ${options.appRole};

create table ${s}.till_closings (
  closing_id text primary key,
  organization_id text not null,
  account_id text not null references ${s}.accounts (account_id),
  closed_on date not null,
  expected bigint not null,
  counted bigint not null check (counted >= 0),
  difference bigint not null,
  note text,
  closed_by text not null,
  created_at timestamptz not null default now(),
  unique (account_id, closed_on),
  check (difference = counted - expected)
);
${policy('till_closings')}
grant select, insert on ${s}.till_closings to ${options.appRole};
`;
}

type AccountRow = {
  account_id: string;
  name: string;
  kind: AccountKind;
  currency: string;
  opening: string;
  opened_on: string;
  active: boolean;
  balance: string;
  closed_on: string | null;
};

const accountColumns = `a.account_id, a.name, a.kind, a.currency, a.opening,
  to_char(a.opened_on, 'YYYY-MM-DD') as opened_on, a.active,
  a.opening + coalesce((select sum(case when m.direction = 'in' then m.amount else -m.amount end)
                          from account_movements m where m.account_id = a.account_id), 0) as balance,
  (select to_char(max(c.closed_on), 'YYYY-MM-DD') from till_closings c
    where c.account_id = a.account_id) as closed_on`;

const toAccount = (row: AccountRow): Account => ({
  accountId: row.account_id,
  name: row.name,
  kind: row.kind,
  currency: row.currency,
  opening: Number(row.opening),
  openedOn: row.opened_on,
  active: row.active,
  balance: Number(row.balance),
  closedOn: row.closed_on,
});

export async function insertAccount(
  db: SqlExecutor,
  account: {
    organizationId: string;
    name: string;
    kind: AccountKind;
    currency: string;
    opening: number;
    openedOn: string;
    createdBy: string;
  },
): Promise<string> {
  const accountId = newId('acc');
  await db.query(
    `insert into accounts (account_id, organization_id, name, kind, currency, opening, opened_on, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      accountId,
      account.organizationId,
      account.name,
      account.kind,
      account.currency,
      account.opening,
      account.openedOn,
      account.createdBy,
    ],
  );
  return accountId;
}

export async function listAccounts(db: SqlExecutor): Promise<Account[]> {
  const { rows } = await db.query<AccountRow>(
    `select ${accountColumns} from accounts a order by a.active desc, a.kind, a.created_at, a.account_id`,
  );
  return rows.map(toAccount);
}

export async function findAccount(db: SqlExecutor, accountId: string): Promise<Account | null> {
  const { rows } = await db.query<AccountRow>(
    `select ${accountColumns} from accounts a where a.account_id = $1`,
    [accountId],
  );
  return rows[0] ? toAccount(rows[0]) : null;
}

/** What an account held at the end of a day. */
export async function balanceOn(db: SqlExecutor, accountId: string, day: string): Promise<number> {
  const { rows } = await db.query<{ balance: string }>(
    `select a.opening + coalesce((select sum(case when m.direction = 'in' then m.amount else -m.amount end)
                                    from account_movements m
                                   where m.account_id = a.account_id and m.occurred_on <= $2::date), 0)
            as balance
       from accounts a where a.account_id = $1`,
    [accountId, day],
  );
  return Number(rows[0]?.balance ?? 0);
}

/** The account a way of paying goes to: the first active one of its kind; none when there is none. */
async function accountFor(db: SqlExecutor, method: Method): Promise<Account | null> {
  const { rows } = await db.query<AccountRow>(
    `select ${accountColumns} from accounts a
      where a.active and a.kind = $1 order by a.created_at, a.account_id limit 1`,
    [kindOfMethod(method)],
  );
  return rows[0] ? toAccount(rows[0]) : null;
}

/** A till counted and closed for a day takes nothing dated that day or before. */
function open(account: Account, day: string): void {
  if (!account.active) throw new TreasuryRuleError('account_closed');
  if (account.closedOn && day <= account.closedOn) throw new TreasuryRuleError('till_closed');
}

export interface MoneyMoved {
  direction: 'in' | 'out';
  amount: number;
  /** The day the money moved. */
  on: string;
  method: Method;
  label: string;
  /** What it comes from, once: `receipt:<id>`, `payment:<id>`. */
  source: string;
  projectId?: string | null;
  recordedBy: string;
}

/**
 * Money came in or went out: the movement lands on the account its way of paying goes to, in the
 * transaction of the gesture that moves it. Without an account of that kind it waits to be
 * assigned — the gesture is never stopped for that. It is stopped when the till is closed for
 * that day, and when a till or a wallet does not hold what would leave it.
 */
export async function moveMoney(
  db: SqlExecutor,
  organizationId: string,
  moved: MoneyMoved,
): Promise<string> {
  const account = await accountFor(db, moved.method);
  if (account) {
    open(account, moved.on);
    if (moved.direction === 'out') leaving(account.kind, account.balance, moved.amount);
  }
  return insertMovement(db, organizationId, { ...moved, accountId: account?.accountId ?? null });
}

export async function insertMovement(
  db: SqlExecutor,
  organizationId: string,
  movement: Omit<MoneyMoved, 'source'> & { source: string | null; accountId: string | null },
): Promise<string> {
  const movementId = newId('mov');
  await db.query(
    `insert into account_movements
       (movement_id, organization_id, account_id, direction, amount, occurred_on, method, label,
        source, project_id, recorded_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      movementId,
      organizationId,
      movement.accountId,
      movement.direction,
      movement.amount,
      movement.on,
      movement.method,
      movement.label,
      movement.source,
      movement.projectId ?? null,
      movement.recordedBy,
    ],
  );
  return movementId;
}

/** Checks that an account takes a movement on a day, and holds what would leave it. */
export async function taking(
  db: SqlExecutor,
  accountId: string,
  movement: { direction: 'in' | 'out'; amount: number; on: string },
): Promise<Account> {
  const account = await findAccount(db, accountId);
  if (!account) throw new TreasuryRuleError('account_not_found');
  open(account, movement.on);
  if (movement.direction === 'out') leaving(account.kind, account.balance, movement.amount);
  return account;
}

type MovementRow = {
  movement_id: string;
  account_id: string | null;
  direction: 'in' | 'out';
  amount: string;
  occurred_on: string;
  method: Method;
  label: string;
  source: string | null;
  project_id: string | null;
};

const movementColumns = `movement_id, account_id, direction, amount,
  to_char(occurred_on, 'YYYY-MM-DD') as occurred_on, method, label, source, project_id`;

const toMovement = (row: MovementRow): Movement => ({
  movementId: row.movement_id,
  accountId: row.account_id,
  direction: row.direction,
  amount: Number(row.amount),
  on: row.occurred_on,
  method: row.method,
  label: row.label,
  source: row.source,
  projectId: row.project_id,
});

export async function movementsOf(
  db: SqlExecutor,
  accountId: string | null,
  limit = 200,
): Promise<Movement[]> {
  const { rows } = await db.query<MovementRow>(
    `select ${movementColumns} from account_movements
      where ($1::text is null and account_id is null) or account_id = $1
      order by occurred_on desc, created_at desc limit $2`,
    [accountId, limit],
  );
  return rows.map(toMovement);
}

export async function findMovement(db: SqlExecutor, movementId: string): Promise<Movement | null> {
  const { rows } = await db.query<MovementRow>(
    `select ${movementColumns} from account_movements where movement_id = $1`,
    [movementId],
  );
  return rows[0] ? toMovement(rows[0]) : null;
}

export async function assignMovement(
  db: SqlExecutor,
  movementId: string,
  accountId: string,
): Promise<void> {
  await db.query(
    `update account_movements set account_id = $2 where movement_id = $1 and account_id is null`,
    [movementId, accountId],
  );
}

export async function insertClosing(
  db: SqlExecutor,
  closing: {
    organizationId: string;
    accountId: string;
    closedOn: string;
    expected: number;
    counted: number;
    note?: string | undefined;
    closedBy: string;
  },
): Promise<string> {
  const closingId = newId('cls');
  await db.query(
    `insert into till_closings
       (closing_id, organization_id, account_id, closed_on, expected, counted, difference, note,
        closed_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      closingId,
      closing.organizationId,
      closing.accountId,
      closing.closedOn,
      closing.expected,
      closing.counted,
      closing.counted - closing.expected,
      closing.note ?? null,
      closing.closedBy,
    ],
  );
  return closingId;
}

export async function closingsOf(db: SqlExecutor, accountId: string, limit = 60): Promise<Closing[]> {
  const { rows } = await db.query<{
    closing_id: string;
    closed_on: string;
    expected: string;
    counted: string;
    difference: string;
    note: string | null;
  }>(
    `select closing_id, to_char(closed_on, 'YYYY-MM-DD') as closed_on, expected, counted,
            difference, note
       from till_closings where account_id = $1 order by closed_on desc limit $2`,
    [accountId, limit],
  );
  return rows.map((row) => ({
    closingId: row.closing_id,
    closedOn: row.closed_on,
    expected: Number(row.expected),
    counted: Number(row.counted),
    difference: Number(row.difference),
    note: row.note,
  }));
}

/** What is held, all accounts together; and how many movements wait for their account. */
export async function heldNow(db: SqlExecutor): Promise<{ held: number; unassigned: number }> {
  const { rows } = await db.query<{ held: string; unassigned: string }>(
    `select
       (select coalesce(sum(opening), 0) from accounts where active)
       + (select coalesce(sum(case when m.direction = 'in' then m.amount else -m.amount end), 0)
            from account_movements m join accounts a on a.account_id = m.account_id
           where a.active) as held,
       (select count(*) from account_movements where account_id is null) as unassigned`,
  );
  return { held: Number(rows[0]?.held ?? 0), unassigned: Number(rows[0]?.unassigned ?? 0) };
}
