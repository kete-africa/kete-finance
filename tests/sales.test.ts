import { readFileSync } from 'node:fs';
import type { KeteIdentity } from '@kete/auth';
import { assignBusinessRole, performGesture, type Caller } from '@kete/capabilities';
import { validateManifest, validateMoneyFact } from '@kete/sdk';
import { assertOrganizationIsolation, createTestSchema, type TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { migrations } from '../db/migrations';
import { countUntold, listFacts } from '../src/features/register';
import { budgetOf, partOf, SalesRuleError, totalsOf } from '../src/features/sales/domain/sales';
import { findInvoice, findQuote } from '../src/features/sales/infrastructure/sales.table';
import { transaction, usePool } from '../src/platform/db';
import { manifest } from '../src/platform/events';
import { datasets, registry } from '../src/platform/registry';
import { asPerson } from '../src/platform/rights';
import { screenActor } from '../src/platform/session';
import { syncCenter } from '../src/platform/sync';

// Spec 001 — sales. The proof of step G1: « A won quote becomes a project with its budget »; and
// around it: totals to the unit, invoices numbered without a gap, money received never beyond
// what is due, three roles kept apart, and a center that hears every fact — late if it must.

const ORG = 'org_acme';
let db: TestSchema;

const person = (userId: string, role: KeteIdentity['role'], organizationId = ORG) =>
  ({
    userId,
    email: `${userId}@example.test`,
    name: userId,
    organizationId,
    role,
    apps: {},
    twoFactor: false,
    expiresAt: new Date(Date.now() + 60_000),
  }) satisfies KeteIdentity;

const ama = person('usr_ama', 'owner');
const kofi = person('usr_kofi', 'member'); // sells
const essi = person('usr_essi', 'member'); // keeps the accounts
const yao = person('usr_yao', 'member'); // holds the till
const edem = person('usr_edem', 'member'); // no role of the trade

const onScreen = (identity: KeteIdentity): Caller => ({
  actor: screenActor(identity),
  organizationId: identity.organizationId ?? ORG,
});

// The center, as the app's client reaches it: what it was asked, and how it answers.
const center = {
  projects: [] as { projectId: string; body: Record<string, unknown> }[],
  facts: new Map<string, Record<string, unknown>>(),
  calls: [] as string[],
  away: false,
  refusesMoney: false,
};

function fakeCenter(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const path = url.replace('https://api.center.test', '');
  if (center.away) return Promise.reject(new Error('the center is away'));
  center.calls.push(`${init?.method ?? 'GET'} ${path}`);
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  if (path === '/v1/projects' && init?.method === 'POST') {
    const born = body['bornFrom'] as { ref: string };
    let project = center.projects.find(
      (p) => (p.body['bornFrom'] as { ref: string }).ref === born.ref,
    );
    const created = !project;
    if (!project) {
      project = {
        projectId: `prj_${String(center.projects.length + 1).padStart(32, '0')}`,
        body,
      };
      center.projects.push(project);
    }
    return Promise.resolve(
      Response.json({ project: { projectId: project.projectId, name: body['name'] }, created }),
    );
  }
  if (path === '/v1/money/facts' && init?.method === 'POST') {
    if (center.refusesMoney) return Promise.resolve(Response.json({ error: 'forbidden' }, { status: 403 }));
    const fact = body['fact'] as Record<string, unknown>;
    center.facts.set(String(fact['key']), fact);
    return Promise.resolve(Response.json({ ok: true }));
  }
  // Her grants: this center does not manage the app's rights, the defaults stand.
  return Promise.resolve(Response.json({ error: 'not_found' }, { status: 404 }));
}

/** A person's gesture, as her screen makes it: the capability, then the center hears of it. */
async function gesture<T = Record<string, unknown>>(
  who: KeteIdentity,
  name: string,
  input: unknown,
) {
  const caller = onScreen(who);
  const outcome = await performGesture<T>(registry, { ...caller, name, input }, (work) =>
    asPerson(who, work),
  );
  if (outcome.ok) await syncCenter(`${who.userId}-token`, caller);
  return outcome;
}

const done = <T>(outcome: { ok: true; output: T } | { ok: false; code: string }): T => {
  if (!outcome.ok) throw new Error(`refused: ${outcome.code}`);
  return outcome.output;
};

const year = new Date().getUTCFullYear();
const solarQuote = {
  title: 'Centrale solaire 12 kWc — Clinique Biasa',
  partyId: 'pty_0000000000000000000000000000c1c1',
  partyName: 'Clinique Biasa',
  taxRate: 18,
  lines: [
    { label: 'Panneau 450 W', quantity: 8, unitPrice: 245_000, unitCost: 180_000, post: 'Matériel' },
    { label: 'Pose et mise en service', quantity: 1, unitPrice: 400_000, unitCost: 250_000, post: 'Main-d’œuvre' },
    { label: 'Câbles et protections', quantity: 2, unitPrice: 60_000, unitCost: 45_000, post: 'Matériel' },
  ],
};
const ids = {} as Record<'quote' | 'deposit' | 'rest' | 'late', string>;

beforeAll(async () => {
  process.env.ENTERPRISE_API_URL = 'https://api.center.test';
  process.env.PUBLIC_URL = 'https://gestion.test';
  vi.stubGlobal('fetch', fakeCenter);
  db = await createTestSchema({
    migrate: async (owner, context) => {
      for (const migration of migrations) await owner.query(migration.sql(context));
    },
  });
  usePool(db.app);
  await transaction(ORG, async (client) => {
    await assignBusinessRole(client, ORG, kofi.userId, 'sales');
    await assignBusinessRole(client, ORG, essi.userId, 'accountant');
    await assignBusinessRole(client, ORG, yao.userId, 'cashier');
  });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  delete process.env.ENTERPRISE_API_URL;
  await db.drop();
});

describe('the arithmetic of a document', () => {
  it('computes totals, tax, cost and margin from the lines, each rounded once', () => {
    expect(totalsOf(solarQuote.lines, 18, 'XOF')).toEqual({
      subtotal: 2_480_000,
      tax: 446_400,
      total: 2_926_400,
      cost: 1_780_000,
      margin: 700_000,
    });
    // 2,5 h at 8 333 F: rounded once, on the line.
    expect(totalsOf([{ quantity: 2.5, unitPrice: 8_333, unitCost: 0 }], 0, 'XOF').subtotal).toBe(
      20_833,
    );
  });

  it('gives a project its budget: the cost of each post, two lines on one post added', () => {
    expect(budgetOf(solarQuote.lines, 'XOF')).toEqual([
      { name: 'Matériel', budget: 1_530_000 },
      { name: 'Main-d’œuvre', budget: 250_000 },
    ]);
  });

  it('splits a quote into invoices that add up to it, to the unit', () => {
    const quote = { subtotal: 1_000_001, tax: 180_000, taxRate: 18 };
    const first = partOf(quote, { subtotal: 0, tax: 0 }, 30, 'XOF');
    const second = partOf(quote, first, 30, 'XOF');
    const taken = { subtotal: first.subtotal + second.subtotal, tax: first.tax + second.tax };
    const last = partOf(quote, taken, 100, 'XOF');
    expect(first.subtotal + second.subtotal + last.subtotal).toBe(quote.subtotal);
    expect(first.tax + second.tax + last.tax).toBe(quote.tax);
    expect(() =>
      partOf(quote, { subtotal: quote.subtotal, tax: quote.tax }, 10, 'XOF'),
    ).toThrow(SalesRuleError);
  });
});

describe('a won quote becomes a project with its budget', () => {
  it('is written by who sells, numbered at once, with its totals computed', async () => {
    const written = done(
      await gesture<{ quoteId: string; number: string; total: number }>(kofi, 'quotes_create', solarQuote),
    );
    ids.quote = written.quoteId;
    expect(written).toMatchObject({ number: `D-${year}-0001`, total: 2_926_400 });
    const quote = await transaction(ORG, (tx) => findQuote(tx, ids.quote));
    expect(quote).toMatchObject({ status: 'draft', cost: 1_780_000, currency: 'XOF' });
    expect(quote?.lines).toHaveLength(3);
    // Nothing went to the center: a draft is nobody's project.
    expect(center.projects).toEqual([]);
  });

  it('opens its project at the center when won: client, amount sold, one post per budget post', async () => {
    done(await gesture(kofi, 'quotes_send', { quoteId: ids.quote }));
    // Sent: what the client read is no longer rewritten.
    expect(await gesture(kofi, 'quotes_update', { quoteId: ids.quote, ...solarQuote })).toMatchObject(
      { ok: false, code: 'quote_not_draft' },
    );
    done(await gesture(kofi, 'quotes_win', { quoteId: ids.quote }));

    expect(center.projects).toHaveLength(1);
    expect(center.projects[0]?.body).toEqual({
      name: 'Centrale solaire 12 kWc — Clinique Biasa',
      partyId: 'pty_0000000000000000000000000000c1c1',
      sold: 2_926_400,
      currency: 'XOF',
      posts: [
        { name: 'Matériel', budget: 1_530_000 },
        { name: 'Main-d’œuvre', budget: 250_000 },
      ],
      bornFrom: { source: 'kete-gestion', ref: `D-${year}-0001` },
    });
    const quote = await transaction(ORG, (tx) => findQuote(tx, ids.quote));
    expect(quote).toMatchObject({
      status: 'won',
      projectId: center.projects[0]?.projectId,
      projectName: 'Centrale solaire 12 kWc — Clinique Biasa',
    });
  });

  it('is won once, and asks the center for its project once', async () => {
    expect(await gesture(kofi, 'quotes_win', { quoteId: ids.quote })).toMatchObject({
      ok: false,
      code: 'quote_not_open',
    });
    await syncCenter('usr_ama-token', onScreen(ama));
    expect(center.calls.filter((call) => call === 'POST /v1/projects')).toHaveLength(1);
  });
});

describe('invoices and money received', () => {
  it('prepares a deposit of 30 %: a draft without a number, nothing said to anyone', async () => {
    const prepared = done(
      await gesture<{ invoiceId: string; total: number }>(kofi, 'invoices_from_quote', {
        quoteId: ids.quote,
        share: 30,
        label: 'Acompte 30 %',
      }),
    );
    ids.deposit = prepared.invoiceId;
    expect(prepared.total).toBe(744_000 + 133_920);
    const invoice = await transaction(ORG, (tx) => findInvoice(tx, ids.deposit));
    expect(invoice).toMatchObject({
      status: 'draft',
      number: null,
      projectId: center.projects[0]?.projectId,
    });
    expect(center.facts.size).toBe(0);
  });

  it('keeps who sells from issuing, and who issues from holding the till', async () => {
    expect(await gesture(kofi, 'invoices_issue', { invoiceId: ids.deposit })).toMatchObject({
      ok: false,
      code: 'not_allowed',
    });
    expect(await gesture(yao, 'invoices_issue', { invoiceId: ids.deposit })).toMatchObject({
      ok: false,
      code: 'not_allowed',
    });
    expect(await gesture(yao, 'quotes_create', solarQuote)).toMatchObject({
      ok: false,
      code: 'not_allowed',
    });
    // Without a role of the trade, a member reads nothing.
    expect(await gesture(edem, 'invoice_list', {})).toMatchObject({ ok: false, code: 'not_allowed' });
  });

  it('issues it: the first number of the year, and the center hears what is due on the project', async () => {
    const issued = done(
      await gesture<{ number: string }>(essi, 'invoices_issue', { invoiceId: ids.deposit }),
    );
    expect(issued.number).toBe(`F-${year}-0001`);
    const fact = center.facts.get(`invoice:${ids.deposit}`);
    expect(fact).toMatchObject({
      kind: 'invoiced',
      amount: 877_920,
      currency: 'XOF',
      project_id: center.projects[0]?.projectId,
      party_id: 'pty_0000000000000000000000000000c1c1',
      href: `https://gestion.test/ventes/factures/${ids.deposit}`,
    });
    // What travels is the contract's fact, nothing else.
    expect(validateMoneyFact(fact).ok).toBe(true);
    // Issued: never issued again, never thrown away.
    expect(await gesture(essi, 'invoices_issue', { invoiceId: ids.deposit })).toMatchObject({
      ok: false,
      code: 'invoice_not_draft',
    });
    expect(await gesture(kofi, 'invoices_discard', { invoiceId: ids.deposit })).toMatchObject({
      ok: false,
      code: 'invoice_not_draft',
    });
  });

  it('records what the till takes in, never beyond what is due', async () => {
    const received = done(
      await gesture<{ receiptId: string; due: number }>(yao, 'receipts_record', {
        invoiceId: ids.deposit,
        amount: 500_000,
        receivedOn: `${year}-10-13`,
        method: 'mobile',
        reference: 'TMoney 7H2K',
      }),
    );
    expect(received.due).toBe(377_920);
    expect(center.facts.get(`receipt:${received.receiptId}`)).toMatchObject({
      kind: 'received',
      amount: 500_000,
      occurred_on: `${year}-10-13`,
      project_id: center.projects[0]?.projectId,
    });
    // The invoice's fact now says what stays due.
    expect(center.facts.get(`invoice:${ids.deposit}`)).toMatchObject({ amount: 377_920 });
    expect(
      await gesture(yao, 'receipts_record', {
        invoiceId: ids.deposit,
        amount: 377_921,
        receivedOn: `${year}-10-14`,
        method: 'cash',
      }),
    ).toMatchObject({ ok: false, code: 'more_than_due' });
    // Who sells does not take money in.
    expect(
      await gesture(kofi, 'receipts_record', {
        invoiceId: ids.deposit,
        amount: 1000,
        receivedOn: `${year}-10-14`,
        method: 'cash',
      }),
    ).toMatchObject({ ok: false, code: 'not_allowed' });
  });

  it('numbers without a gap: a draft thrown away takes no number, the rest adds up to the quote', async () => {
    const thrown = done(
      await gesture<{ invoiceId: string }>(kofi, 'invoices_from_quote', {
        quoteId: ids.quote,
        share: 10,
        label: 'Étape',
      }),
    );
    done(await gesture(kofi, 'invoices_discard', { invoiceId: thrown.invoiceId }));
    const rest = done(
      await gesture<{ invoiceId: string; total: number }>(kofi, 'invoices_from_quote', {
        quoteId: ids.quote,
        share: 100,
        label: 'Solde',
      }),
    );
    ids.rest = rest.invoiceId;
    expect(rest.total).toBe(2_926_400 - 877_920);
    expect(
      done(await gesture<{ number: string }>(essi, 'invoices_issue', { invoiceId: ids.rest })).number,
    ).toBe(`F-${year}-0002`);
    // Wholly invoiced: nothing is left to invoice.
    expect(
      await gesture(kofi, 'invoices_from_quote', { quoteId: ids.quote, share: 5, label: 'Trop' }),
    ).toMatchObject({ ok: false, code: 'nothing_left_to_invoice' });
    const quote = await transaction(ORG, (tx) => findQuote(tx, ids.quote));
    expect(quote?.invoiced).toBe(quote?.total);
  });

  it('lets an agent prepare, never issue: issuing waits for a person', async () => {
    const draft = done(
      await gesture<{ invoiceId: string }>(kofi, 'invoices_create', {
        title: 'Entretien annuel',
        partyName: 'Hôtel Sarakawa',
        taxRate: 0,
        lines: [{ label: 'Visite', quantity: 1, unitPrice: 75_000 }],
      }),
    );
    ids.late = draft.invoiceId;
    const asked = await asPerson(essi, () =>
      registry.invoke({
        actor: {
          kind: 'agent',
          id: 'agt_mcp',
          channel: 'mcp',
          onBehalfOf: { kind: 'person', id: essi.userId },
        },
        organizationId: ORG,
        name: 'invoices_issue',
        input: { invoiceId: ids.late },
      }),
    );
    expect(asked).toMatchObject({ status: 'draft' });
    expect(await transaction(ORG, (tx) => findInvoice(tx, ids.late))).toMatchObject({
      status: 'draft',
      number: null,
    });
  });
});

describe('a center that is away, or that refuses', () => {
  it('keeps the facts in the register, and tells them with the next gesture of someone who may', async () => {
    center.away = true;
    // Without a project: it counts in the organization's running.
    done(await gesture(essi, 'invoices_issue', { invoiceId: ids.late }));
    expect(center.facts.has(`invoice:${ids.late}`)).toBe(false);
    expect(await transaction(ORG, (tx) => countUntold(tx))).toBe(1);

    center.away = false;
    center.refusesMoney = true;
    // The center answers, but she may not record money there: the fact still waits.
    expect(await syncCenter('usr_kofi-token', onScreen(kofi))).toMatchObject({ told: 0, waiting: 1 });

    center.refusesMoney = false;
    expect(await syncCenter('usr_ama-token', onScreen(ama))).toMatchObject({ told: 1, waiting: 0 });
    const fact = center.facts.get(`invoice:${ids.late}`);
    expect(fact).toMatchObject({ kind: 'invoiced', amount: 75_000 });
    expect(fact).not.toHaveProperty('project_id');
  });

  it('opens a won quote’s project late, and moves what was already invoiced to it', async () => {
    center.away = true;
    const quote = done(
      await gesture<{ quoteId: string }>(kofi, 'quotes_create', {
        title: 'Kit solaire — Pharmacie du Port',
        partyName: 'Pharmacie du Port',
        taxRate: 0,
        lines: [{ label: 'Kit 3 kWc', quantity: 1, unitPrice: 900_000, unitCost: 650_000, post: 'Matériel' }],
      }),
    );
    done(await gesture(kofi, 'quotes_win', { quoteId: quote.quoteId }));
    const invoice = done(
      await gesture<{ invoiceId: string }>(kofi, 'invoices_from_quote', {
        quoteId: quote.quoteId,
        share: 100,
        label: 'Kit 3 kWc',
      }),
    );
    done(await gesture(essi, 'invoices_issue', { invoiceId: invoice.invoiceId }));
    expect(await transaction(ORG, (tx) => findQuote(tx, quote.quoteId))).toMatchObject({
      status: 'won',
      projectId: null,
    });

    center.away = false;
    expect(await syncCenter('usr_ama-token', onScreen(ama))).toMatchObject({ opened: 1, waiting: 0 });
    const projectId = center.projects[1]?.projectId;
    expect(await transaction(ORG, (tx) => findInvoice(tx, invoice.invoiceId))).toMatchObject({
      projectId,
    });
    expect(center.facts.get(`invoice:${invoice.invoiceId}`)).toMatchObject({
      amount: 900_000,
      project_id: projectId,
    });
  });
});

describe('the register of money', () => {
  it('holds every fact once under its key, by project', async () => {
    const facts = await transaction(ORG, (tx) =>
      listFacts(tx, { projectId: center.projects[0]?.projectId ?? '' }),
    );
    expect(facts.map((fact) => [fact.kind, fact.amount]).sort()).toEqual(
      [
        ['invoiced', 377_920],
        ['invoiced', 2_048_480],
        ['received', 500_000],
      ].sort(),
    );
  });
});

describe('the organization is the boundary', () => {
  it('keeps each organization’s quotes, invoices and register to itself (RLS)', async () => {
    await assertOrganizationIsolation({
      app: db.app,
      table: 'quotes',
      organizations: ['org_x', 'org_y'],
      insert: async (client, organizationId) => {
        await client.query(
          `insert into quotes (quote_id, organization_id, number, title, party_name, currency,
                               subtotal, tax, total, cost, created_by)
           values ($1, $2, 'D-1', 'x', 'x', 'XOF', 0, 0, 0, 0, 'usr_x')`,
          [`quo_${organizationId}`, organizationId],
        );
      },
    });
    await assertOrganizationIsolation({
      app: db.app,
      table: 'invoices',
      organizations: ['org_x', 'org_y'],
      insert: async (client, organizationId) => {
        await client.query(
          `insert into invoices (invoice_id, organization_id, title, party_name, currency,
                                 subtotal, tax, total, created_by)
           values ($1, $2, 'x', 'x', 'XOF', 0, 0, 0, 'usr_x')`,
          [`inv_${organizationId}`, organizationId],
        );
      },
    });
    await assertOrganizationIsolation({
      app: db.app,
      table: 'money_register',
      organizations: ['org_x', 'org_y'],
      insert: async (client, organizationId) => {
        await client.query(
          `insert into money_register (organization_id, fact_key, kind, amount, currency,
                                       occurred_on, label)
           values ($1, 'k', 'received', 1, 'XOF', current_date, 'x')`,
          [organizationId],
        );
      },
    });
  });
});

describe('what the app says about itself', () => {
  it('serves a valid manifest: its gestures, its data set, its permissions, its events', () => {
    const card = manifest();
    expect(validateManifest(card).ok).toBe(true);
    expect(card).toMatchObject({ product: 'prd_kete_gestion', events: ['metrics.daily'] });
    expect(card.capabilities?.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'quote_list',
        'quote_get',
        'invoice_list',
        'invoice_get',
        'quotes_create',
        'quotes_win',
        'invoices_issue',
        'receipts_record',
      ]),
    );
    expect(card.datasets?.map((d) => d.name)).toEqual(['invoices']);
    const issue = card.permissions?.find((p) => p.name === 'sales:issue');
    expect(issue).toMatchObject({ roles: ['owner', 'admin'] });
    expect(issue?.label.fr).toBeTruthy();
    expect(issue?.label.en).toBeTruthy();
    expect(card.emits?.map((e) => e.type)).toEqual(['quote.won', 'invoice.issued', 'receipt.recorded']);
  });

  it('reads the invoices as a data set, under the read permission', async () => {
    const read = await asPerson(essi, () =>
      datasets.read(onScreen(essi), 'invoices', { from: `${year}-01-01` }),
    );
    expect(read).toMatchObject({ status: 'done', dataset: 'invoices' });
    expect(await asPerson(edem, () => datasets.read(onScreen(edem), 'invoices', {}))).toEqual({
      status: 'refused',
      reason: 'not_allowed',
    });
  });

  it('announces a won quote to the center, in its own outbox, without a name', async () => {
    const { rows } = await db.owner.query<{ envelope: { type: string; data: object } }>(
      `select envelope from ${db.schema}.kete_center_outbox
        where envelope->>'type' = 'quote.won' order by created_at limit 1`,
    );
    expect(rows[0]?.envelope).toMatchObject({
      type: 'quote.won',
      data: { quoteId: ids.quote, total: 2_926_400 },
    });
    expect(JSON.stringify(rows[0]?.envelope)).not.toContain('Biasa');
  });

  it('says the same words in every language', () => {
    const fr = JSON.parse(readFileSync(new URL('../messages/fr.json', import.meta.url), 'utf8'));
    const en = JSON.parse(readFileSync(new URL('../messages/en.json', import.meta.url), 'utf8'));
    expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort());
  });
});
