import { newId } from '@kete/records';
import { organizationPolicySql, type SqlExecutor } from '@kete/tenancy';
import type { InvoiceStatus, QuoteStatus, Totals } from '../domain/sales';
import type { Invoice, Quote, QuoteLine, Receipt, ReceiptMethod } from '../quote.record';

/** Quotes, invoices and receipts, each with its row-level security in the same migration. */
export function salesMigrationSql(options: { schema: string; appRole: string }): string {
  const s = options.schema;
  const policy = (table: string) =>
    organizationPolicySql({ schema: s, table, appRole: options.appRole });
  return `
create table ${s}.quotes (
  quote_id text primary key,
  organization_id text not null,
  number text not null,
  title text not null check (length(title) between 1 and 200),
  party_id text,
  party_name text not null,
  status text not null default 'draft' check (status in ('draft', 'sent', 'won', 'lost')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  tax_rate numeric(5, 2) not null default 0 check (tax_rate between 0 and 100),
  subtotal bigint not null check (subtotal >= 0),
  tax bigint not null check (tax >= 0),
  total bigint not null check (total >= 0),
  cost bigint not null check (cost >= 0),
  valid_until date,
  project_id text,
  project_name text,
  won_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, number)
);
create index quotes_by_status on ${s}.quotes (organization_id, status, created_at desc);
${policy('quotes')}
grant select, insert, update on ${s}.quotes to ${options.appRole};

create table ${s}.quote_lines (
  organization_id text not null,
  quote_id text not null references ${s}.quotes (quote_id) on delete cascade,
  position int not null,
  label text not null,
  quantity numeric(12, 3) not null check (quantity > 0),
  unit_price bigint not null check (unit_price >= 0),
  unit_cost bigint not null default 0 check (unit_cost >= 0),
  post text not null,
  primary key (quote_id, position)
);
${policy('quote_lines')}
grant select, insert, delete on ${s}.quote_lines to ${options.appRole};

create table ${s}.invoices (
  invoice_id text primary key,
  organization_id text not null,
  number text,
  quote_id text references ${s}.quotes (quote_id),
  title text not null check (length(title) between 1 and 200),
  party_id text,
  party_name text not null,
  project_id text,
  status text not null default 'draft' check (status in ('draft', 'issued')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  tax_rate numeric(5, 2) not null default 0 check (tax_rate between 0 and 100),
  subtotal bigint not null check (subtotal >= 0),
  tax bigint not null check (tax >= 0),
  total bigint not null check (total >= 0),
  received bigint not null default 0 check (received >= 0 and received <= total),
  issued_on date,
  due_on date,
  created_by text not null,
  issued_by text,
  created_at timestamptz not null default now(),
  unique (organization_id, number),
  -- An issued invoice has its number and its day; a draft has neither.
  check ((status = 'issued') = (number is not null and issued_on is not null))
);
create index invoices_by_status on ${s}.invoices (organization_id, status, created_at desc);
create index invoices_by_quote on ${s}.invoices (quote_id);
${policy('invoices')}
grant select, insert, update, delete on ${s}.invoices to ${options.appRole};

create table ${s}.invoice_lines (
  organization_id text not null,
  invoice_id text not null references ${s}.invoices (invoice_id) on delete cascade,
  position int not null,
  label text not null,
  quantity numeric(12, 3) not null check (quantity > 0),
  unit_price bigint not null check (unit_price >= 0),
  primary key (invoice_id, position)
);
${policy('invoice_lines')}
grant select, insert, delete on ${s}.invoice_lines to ${options.appRole};

create table ${s}.receipts (
  receipt_id text primary key,
  organization_id text not null,
  invoice_id text not null references ${s}.invoices (invoice_id),
  amount bigint not null check (amount > 0),
  received_on date not null,
  method text not null check (method in ('cash', 'bank', 'mobile', 'cheque')),
  reference text,
  recorded_by text not null,
  created_at timestamptz not null default now()
);
create index receipts_by_invoice on ${s}.receipts (invoice_id);
${policy('receipts')}
grant select, insert on ${s}.receipts to ${options.appRole};
`;
}

type QuoteRow = {
  quote_id: string;
  number: string;
  title: string;
  party_id: string | null;
  party_name: string;
  status: QuoteStatus;
  currency: string;
  tax_rate: string;
  subtotal: string;
  tax: string;
  total: string;
  cost: string;
  valid_until: string | null;
  project_id: string | null;
  project_name: string | null;
  invoiced: string;
  created_on: string;
};

const quoteColumns = `q.quote_id, q.number, q.title, q.party_id, q.party_name, q.status, q.currency,
  q.tax_rate, q.subtotal, q.tax, q.total, q.cost, to_char(q.valid_until, 'YYYY-MM-DD') as valid_until,
  q.project_id, q.project_name, to_char(q.created_at, 'YYYY-MM-DD') as created_on,
  coalesce((select sum(i.total) from invoices i where i.quote_id = q.quote_id), 0) as invoiced`;

const toQuote = (row: QuoteRow, lines: QuoteLine[] = []): Quote => ({
  quoteId: row.quote_id,
  number: row.number,
  title: row.title,
  partyId: row.party_id,
  partyName: row.party_name,
  status: row.status,
  currency: row.currency,
  taxRate: Number(row.tax_rate),
  subtotal: Number(row.subtotal),
  tax: Number(row.tax),
  total: Number(row.total),
  cost: Number(row.cost),
  validUntil: row.valid_until,
  projectId: row.project_id,
  projectName: row.project_name,
  invoiced: Number(row.invoiced),
  createdOn: row.created_on,
  lines,
});

export interface QuoteWritten {
  title: string;
  partyId?: string | undefined;
  partyName: string;
  taxRate: number;
  validUntil?: string | undefined;
  lines: QuoteLine[];
}

async function writeQuoteLines(
  db: SqlExecutor,
  organizationId: string,
  quoteId: string,
  lines: readonly QuoteLine[],
): Promise<void> {
  await db.query(`delete from quote_lines where quote_id = $1`, [quoteId]);
  for (const [position, line] of lines.entries()) {
    await db.query(
      `insert into quote_lines
         (organization_id, quote_id, position, label, quantity, unit_price, unit_cost, post)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        organizationId,
        quoteId,
        position,
        line.label,
        line.quantity,
        line.unitPrice,
        line.unitCost,
        line.post,
      ],
    );
  }
}

export async function insertQuote(
  db: SqlExecutor,
  quote: QuoteWritten & {
    organizationId: string;
    number: string;
    currency: string;
    totals: Totals;
    createdBy: string;
  },
): Promise<string> {
  const quoteId = newId('quo');
  await db.query(
    `insert into quotes
       (quote_id, organization_id, number, title, party_id, party_name, currency, tax_rate,
        subtotal, tax, total, cost, valid_until, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      quoteId,
      quote.organizationId,
      quote.number,
      quote.title,
      quote.partyId ?? null,
      quote.partyName,
      quote.currency,
      quote.taxRate,
      quote.totals.subtotal,
      quote.totals.tax,
      quote.totals.total,
      quote.totals.cost,
      quote.validUntil ?? null,
      quote.createdBy,
    ],
  );
  await writeQuoteLines(db, quote.organizationId, quoteId, quote.lines);
  return quoteId;
}

export async function rewriteQuote(
  db: SqlExecutor,
  organizationId: string,
  quoteId: string,
  quote: QuoteWritten & { totals: Totals },
): Promise<void> {
  await db.query(
    `update quotes set title = $2, party_id = $3, party_name = $4, tax_rate = $5, subtotal = $6,
            tax = $7, total = $8, cost = $9, valid_until = $10
      where quote_id = $1`,
    [
      quoteId,
      quote.title,
      quote.partyId ?? null,
      quote.partyName,
      quote.taxRate,
      quote.totals.subtotal,
      quote.totals.tax,
      quote.totals.total,
      quote.totals.cost,
      quote.validUntil ?? null,
    ],
  );
  await writeQuoteLines(db, organizationId, quoteId, quote.lines);
}

export async function findQuote(db: SqlExecutor, quoteId: string): Promise<Quote | null> {
  const { rows } = await db.query<QuoteRow>(
    `select ${quoteColumns} from quotes q where q.quote_id = $1`,
    [quoteId],
  );
  if (!rows[0]) return null;
  const lines = await db.query<{
    label: string;
    quantity: string;
    unit_price: string;
    unit_cost: string;
    post: string;
  }>(
    `select label, quantity, unit_price, unit_cost, post from quote_lines
      where quote_id = $1 order by position`,
    [quoteId],
  );
  return toQuote(
    rows[0],
    lines.rows.map((line) => ({
      label: line.label,
      quantity: Number(line.quantity),
      unitPrice: Number(line.unit_price),
      unitCost: Number(line.unit_cost),
      post: line.post,
    })),
  );
}

/** Quotes matching a text (or all), the latest first: what `quote_list` returns. */
export async function searchQuotes(
  db: SqlExecutor,
  query: { text?: string | undefined; status?: QuoteStatus | undefined; limit: number },
): Promise<Quote[]> {
  const { rows } = await db.query<QuoteRow>(
    `select ${quoteColumns} from quotes q
      where ($1::text is null or q.title ilike '%' || $1 || '%' or q.party_name ilike '%' || $1 || '%'
             or q.number ilike '%' || $1 || '%')
        and ($2::text is null or q.status = $2)
      order by q.created_at desc, q.quote_id limit $3`,
    [query.text ?? null, query.status ?? null, query.limit],
  );
  return rows.map((row) => toQuote(row));
}

export async function setQuoteStatus(
  db: SqlExecutor,
  quoteId: string,
  status: QuoteStatus,
): Promise<void> {
  await db.query(
    `update quotes set status = $2, won_at = case when $2 = 'won' then now() else won_at end
      where quote_id = $1`,
    [quoteId, status],
  );
}

/** The quote's project, once the center opened it; its invoices follow. */
export async function setQuoteProject(
  db: SqlExecutor,
  quoteId: string,
  project: { projectId: string; name: string },
): Promise<string[]> {
  await db.query(`update quotes set project_id = $2, project_name = $3 where quote_id = $1`, [
    quoteId,
    project.projectId,
    project.name,
  ]);
  const { rows } = await db.query<{ invoice_id: string }>(
    `update invoices set project_id = $2 where quote_id = $1 returning invoice_id`,
    [quoteId, project.projectId],
  );
  return rows.map((row) => row.invoice_id);
}

/** Won quotes whose project the center has not opened yet. */
export async function quotesWithoutProject(db: SqlExecutor, limit = 20): Promise<Quote[]> {
  const { rows } = await db.query<{ quote_id: string }>(
    `select quote_id from quotes where status = 'won' and project_id is null
      order by won_at limit $1`,
    [limit],
  );
  const quotes: Quote[] = [];
  for (const row of rows) {
    const quote = await findQuote(db, row.quote_id);
    if (quote) quotes.push(quote);
  }
  return quotes;
}

/** What the invoices of a quote already took, before and after tax; drafts count. */
export async function invoicedOf(
  db: SqlExecutor,
  quoteId: string,
): Promise<{ subtotal: number; tax: number }> {
  const { rows } = await db.query<{ subtotal: string; tax: string }>(
    `select coalesce(sum(subtotal), 0) as subtotal, coalesce(sum(tax), 0) as tax
       from invoices where quote_id = $1`,
    [quoteId],
  );
  return { subtotal: Number(rows[0]?.subtotal ?? 0), tax: Number(rows[0]?.tax ?? 0) };
}

type InvoiceRow = {
  invoice_id: string;
  number: string | null;
  quote_id: string | null;
  title: string;
  party_id: string | null;
  party_name: string;
  project_id: string | null;
  status: InvoiceStatus;
  currency: string;
  tax_rate: string;
  subtotal: string;
  tax: string;
  total: string;
  received: string;
  issued_on: string | null;
  due_on: string | null;
};

const invoiceColumns = `invoice_id, number, quote_id, title, party_id, party_name, project_id, status,
  currency, tax_rate, subtotal, tax, total, received, to_char(issued_on, 'YYYY-MM-DD') as issued_on,
  to_char(due_on, 'YYYY-MM-DD') as due_on`;

const toInvoice = (
  row: InvoiceRow,
  lines: Invoice['lines'] = [],
  receipts: Receipt[] = [],
): Invoice => ({
  invoiceId: row.invoice_id,
  number: row.number,
  quoteId: row.quote_id,
  title: row.title,
  partyId: row.party_id,
  partyName: row.party_name,
  projectId: row.project_id,
  status: row.status,
  currency: row.currency,
  taxRate: Number(row.tax_rate),
  subtotal: Number(row.subtotal),
  tax: Number(row.tax),
  total: Number(row.total),
  received: Number(row.received),
  issuedOn: row.issued_on,
  dueOn: row.due_on,
  lines,
  receipts,
});

export async function insertInvoice(
  db: SqlExecutor,
  invoice: {
    organizationId: string;
    quoteId?: string | null;
    title: string;
    partyId?: string | null | undefined;
    partyName: string;
    projectId?: string | null | undefined;
    currency: string;
    taxRate: number;
    subtotal: number;
    tax: number;
    total: number;
    dueOn?: string | undefined;
    createdBy: string;
    lines: Invoice['lines'];
  },
): Promise<string> {
  const invoiceId = newId('inv');
  await db.query(
    `insert into invoices
       (invoice_id, organization_id, quote_id, title, party_id, party_name, project_id, currency,
        tax_rate, subtotal, tax, total, due_on, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      invoiceId,
      invoice.organizationId,
      invoice.quoteId ?? null,
      invoice.title,
      invoice.partyId ?? null,
      invoice.partyName,
      invoice.projectId ?? null,
      invoice.currency,
      invoice.taxRate,
      invoice.subtotal,
      invoice.tax,
      invoice.total,
      invoice.dueOn ?? null,
      invoice.createdBy,
    ],
  );
  for (const [position, line] of invoice.lines.entries()) {
    await db.query(
      `insert into invoice_lines (organization_id, invoice_id, position, label, quantity, unit_price)
       values ($1, $2, $3, $4, $5, $6)`,
      [invoice.organizationId, invoiceId, position, line.label, line.quantity, line.unitPrice],
    );
  }
  return invoiceId;
}

export async function findInvoice(db: SqlExecutor, invoiceId: string): Promise<Invoice | null> {
  const { rows } = await db.query<InvoiceRow>(
    `select ${invoiceColumns} from invoices where invoice_id = $1`,
    [invoiceId],
  );
  if (!rows[0]) return null;
  const lines = await db.query<{ label: string; quantity: string; unit_price: string }>(
    `select label, quantity, unit_price from invoice_lines where invoice_id = $1 order by position`,
    [invoiceId],
  );
  const receipts = await db.query<{
    receipt_id: string;
    amount: string;
    received_on: string;
    method: ReceiptMethod;
    reference: string | null;
  }>(
    `select receipt_id, amount, to_char(received_on, 'YYYY-MM-DD') as received_on, method, reference
       from receipts where invoice_id = $1 order by received_on, created_at`,
    [invoiceId],
  );
  return toInvoice(
    rows[0],
    lines.rows.map((line) => ({
      label: line.label,
      quantity: Number(line.quantity),
      unitPrice: Number(line.unit_price),
    })),
    receipts.rows.map((receipt) => ({
      receiptId: receipt.receipt_id,
      amount: Number(receipt.amount),
      receivedOn: receipt.received_on,
      method: receipt.method,
      reference: receipt.reference,
    })),
  );
}

/** Invoices matching a text (or all), the latest first: what `invoice_list` returns. */
export async function searchInvoices(
  db: SqlExecutor,
  query: { text?: string | undefined; due?: boolean | undefined; limit: number },
): Promise<Invoice[]> {
  const { rows } = await db.query<InvoiceRow>(
    `select ${invoiceColumns} from invoices
      where ($1::text is null or title ilike '%' || $1 || '%' or party_name ilike '%' || $1 || '%'
             or number ilike '%' || $1 || '%')
        and (not $2::boolean or (status = 'issued' and received < total))
      order by created_at desc, invoice_id limit $3`,
    [query.text ?? null, query.due ?? false, query.limit],
  );
  return rows.map((row) => toInvoice(row));
}

export async function invoicesOfQuote(db: SqlExecutor, quoteId: string): Promise<Invoice[]> {
  const { rows } = await db.query<InvoiceRow>(
    `select ${invoiceColumns} from invoices where quote_id = $1 order by created_at, invoice_id`,
    [quoteId],
  );
  return rows.map((row) => toInvoice(row));
}

export async function issueInvoice(
  db: SqlExecutor,
  invoiceId: string,
  issued: { number: string; issuedOn: string; issuedBy: string },
): Promise<void> {
  await db.query(
    `update invoices set status = 'issued', number = $2, issued_on = $3, issued_by = $4
      where invoice_id = $1 and status = 'draft'`,
    [invoiceId, issued.number, issued.issuedOn, issued.issuedBy],
  );
}

export async function deleteDraftInvoice(db: SqlExecutor, invoiceId: string): Promise<void> {
  await db.query(`delete from invoices where invoice_id = $1 and status = 'draft'`, [invoiceId]);
}

export async function insertReceipt(
  db: SqlExecutor,
  receipt: {
    organizationId: string;
    invoiceId: string;
    amount: number;
    receivedOn: string;
    method: ReceiptMethod;
    reference?: string | undefined;
    recordedBy: string;
  },
): Promise<string> {
  const receiptId = newId('rcp');
  await db.query(
    `insert into receipts
       (receipt_id, organization_id, invoice_id, amount, received_on, method, reference, recorded_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      receiptId,
      receipt.organizationId,
      receipt.invoiceId,
      receipt.amount,
      receipt.receivedOn,
      receipt.method,
      receipt.reference ?? null,
      receipt.recordedBy,
    ],
  );
  await db.query(`update invoices set received = received + $2 where invoice_id = $1`, [
    receipt.invoiceId,
    receipt.amount,
  ]);
  return receiptId;
}

/** What sales stand at: the figures of the home screen, computed here. */
export async function salesStanding(db: SqlExecutor): Promise<{
  openQuotes: { count: number; total: number };
  toInvoice: number;
  due: number;
  overdue: number;
  receivedThisMonth: number;
}> {
  const { rows } = await db.query<{
    open_count: string;
    open_total: string;
    to_invoice: string;
    due: string;
    overdue: string;
    received_month: string;
  }>(
    `select
       (select count(*) from quotes where status in ('draft', 'sent')) as open_count,
       (select coalesce(sum(total), 0) from quotes where status in ('draft', 'sent')) as open_total,
       (select coalesce(sum(q.total - coalesce(
                 (select sum(i.total) from invoices i where i.quote_id = q.quote_id), 0)), 0)
          from quotes q where q.status = 'won') as to_invoice,
       (select coalesce(sum(total - received), 0) from invoices where status = 'issued') as due,
       (select coalesce(sum(total - received), 0) from invoices
         where status = 'issued' and due_on < current_date) as overdue,
       (select coalesce(sum(amount), 0) from receipts
         where received_on >= date_trunc('month', current_date)) as received_month`,
  );
  const row = rows[0];
  return {
    openQuotes: { count: Number(row?.open_count ?? 0), total: Number(row?.open_total ?? 0) },
    toInvoice: Number(row?.to_invoice ?? 0),
    due: Number(row?.due ?? 0),
    overdue: Number(row?.overdue ?? 0),
    receivedThisMonth: Number(row?.received_month ?? 0),
  };
}

/** Won, not yet wholly invoiced: what was sold and waits for its invoice. */
export async function wonNotInvoiced(db: SqlExecutor, limit = 50): Promise<Quote[]> {
  const { rows } = await db.query<QuoteRow>(
    `select * from (select ${quoteColumns}, q.won_at from quotes q where q.status = 'won') w
      where w.invoiced < w.total order by w.won_at limit $1`,
    [limit],
  );
  return rows.map((row) => toQuote(row));
}

/** The issued invoices of a period, one row each: the `invoices` data set. */
export async function invoiceRows(
  db: SqlExecutor,
  query: { from?: string; to?: string; limit: number },
) {
  const { rows } = await db.query<{
    number: string;
    party_name: string;
    issued_on: string;
    total: string;
    received: string;
  }>(
    `select number, party_name, to_char(issued_on, 'YYYY-MM-DD') as issued_on, total, received
       from invoices
      where status = 'issued'
        and ($1::date is null or issued_on >= $1::date)
        and ($2::date is null or issued_on <= $2::date)
      order by issued_on, number limit $3`,
    [query.from ?? null, query.to ?? null, query.limit],
  );
  return rows.map((row) => ({
    number: row.number,
    party: row.party_name,
    issuedOn: row.issued_on,
    total: Number(row.total),
    received: Number(row.received),
    due: Number(row.total) - Number(row.received),
    paid: Number(row.total) === Number(row.received) ? 1 : 0,
  }));
}
