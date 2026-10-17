import type { KeteIdentity } from '@kete/auth';
import { holdingBody } from '@kete/center';
import { assignBusinessRole, performGesture, type Caller } from '@kete/capabilities';
import { createTestSchema, type TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { migrations } from '../db/migrations';
import { purchaseHoldings } from '../src/features/purchases';
import { findRequest } from '../src/features/purchases/infrastructure/purchases.table';
import { salesHoldings } from '../src/features/sales';
import { transaction, usePool } from '../src/platform/db';
import { registry } from '../src/platform/registry';
import { asPerson } from '../src/platform/rights';
import { screenActor } from '../src/platform/session';
import { syncCenter } from '../src/platform/sync';

// Spec 005 (kete-core spec 114): Kete Finance on the living model. A request passes through the
// organization's policies — allowed as it stands, approved at once; to approve, it waits on who
// they name; refused, with their sentence — and what the app holds is said as holdings.

const ORG = 'org_model';
let db: TestSchema;

const person = (userId: string, role: KeteIdentity['role'], name: string) =>
  ({
    userId,
    email: `${userId}@example.test`,
    name,
    organizationId: ORG,
    role,
    apps: {},
    twoFactor: false,
    expiresAt: new Date(Date.now() + 60_000),
  }) satisfies KeteIdentity;
const essi = person('usr_essi', 'member', 'Essi');
const kofi = person('usr_kofi', 'member', 'Kofi');

const asked: Record<string, unknown>[] = [];

// The center: no circuit for anything; its policies — up to 500 000 F allowed, beyond that the
// manager approves, from 2 000 000 F refused.
function fakeCenter(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const path = url.replace('https://api.center.test', '');
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  if (path === '/v1/apps/prd_kete_finance/gestures') {
    asked.push(body);
    const amount = (body['amount'] as { value: number }).value;
    const verdict =
      amount >= 2_000_000
        ? {
            effect: 'refuse',
            policies: [{ id: 'spend.ceiling', sentence: 'Aucune dépense de 2 000 000 F ou plus' }],
            approvers: [],
          }
        : amount > 500_000
          ? {
              effect: 'approve',
              policies: [{ id: 'spend.over-limit', sentence: 'Au-delà de 500 000 F, son responsable approuve' }],
              approvers: [{ approver: 'manager', people: ['usr_ama'] }],
            }
          : {
              effect: 'allow',
              policies: [{ id: 'spend.people', sentence: 'Une personne engage une dépense' }],
              approvers: [],
            };
    return Promise.resolve(Response.json({ verdict }));
  }
  if (path === '/v1/apps/prd_kete_finance/decisions') {
    return Promise.resolve(Response.json({ error: 'no_circuit' }, { status: 422 }));
  }
  return Promise.resolve(Response.json({ ok: true }));
}

async function gesture<T = Record<string, unknown>>(who: KeteIdentity, name: string, input: unknown) {
  const caller: Caller = { actor: screenActor(who), organizationId: ORG };
  const token = `${who.userId}-token`;
  const outcome = await performGesture<T>(registry, { ...caller, name, input }, (work) =>
    asPerson(who, work, token),
  );
  if (outcome.ok) await syncCenter(token, caller);
  return outcome;
}

const year = new Date().getUTCFullYear();
const note = async (title: string, unitPrice: number) => {
  const outcome = await gesture<{ requestId: string }>(essi, 'expenses_file', {
    title,
    spentOn: `${year}-10-12`,
    lines: [{ label: title, quantity: 1, unitPrice }],
  });
  if (!outcome.ok) throw new Error(`refused: ${outcome.code}`);
  return outcome.output.requestId;
};
const request = (requestId: string) => transaction(ORG, (tx) => findRequest(tx, requestId));

beforeAll(async () => {
  process.env.ENTERPRISE_API_URL = 'https://api.center.test';
  process.env.PUBLIC_URL = 'https://finance.test';
  vi.stubGlobal('fetch', fakeCenter);
  db = await createTestSchema({
    migrate: async (owner, context) => {
      for (const migration of migrations) await owner.query(migration.sql(context));
    },
  });
  usePool(db.app);
  await transaction(ORG, async (client) => {
    await assignBusinessRole(client, ORG, essi.userId, 'accountant');
    await assignBusinessRole(client, ORG, kofi.userId, 'sales');
  });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  delete process.env.ENTERPRISE_API_URL;
  await db.drop();
});

describe('a request through the organization’s policies', () => {
  it('is approved at once when they allow it as it stands', async () => {
    const id = await note('Timbres fiscaux', 15_000);
    expect(asked.at(-1)).toMatchObject({
      kind: 'purchase.commit',
      object: { kind: 'subject', id: 'prd_kete_finance.expense' },
      amount: { value: 15_000, currency: 'XOF' },
    });
    expect(await request(id)).toMatchObject({
      status: 'approved',
      decided: { by: 'les politiques de l’organisation' },
    });
  });

  it('waits on who they name to approve it, as a holding of hers', async () => {
    const id = await note('Billets d’avion Lomé–Abidjan', 700_000);
    expect(await request(id)).toMatchObject({ status: 'asked', route: 'here' });
    const holdings = await transaction(ORG, (tx) => purchaseHoldings(tx));
    const mine = holdings.find((h) => h.ref === id);
    expect(mine).toMatchObject({
      holder: { kind: 'person', id: 'usr_ama' },
      href: `https://finance.test/achats/${id}`,
    });
    expect(mine?.what).toContain('Approuver');
  });

  it('is refused with their sentence', async () => {
    const id = await note('Véhicule de service', 9_000_000);
    expect(await request(id)).toMatchObject({
      status: 'refused',
      decided: { reason: 'Aucune dépense de 2 000 000 F ou plus' },
    });
  });
});

describe('what Kete Finance holds', () => {
  it('says a quote sent and an invoice not paid, each in the contract’s shape', async () => {
    const quote = await gesture<{ quoteId: string }>(kofi, 'quotes_create', {
      title: 'Kit solaire 3 kWc',
      partyName: 'Garage Bè',
      lines: [{ label: 'Kit', quantity: 1, unitPrice: 1_200_000, post: 'Matériel' }],
    });
    if (!quote.ok) throw new Error(quote.code);
    const sent = await gesture(kofi, 'quotes_send', { quoteId: quote.output.quoteId });
    expect(sent.ok).toBe(true);
    const holdings = await transaction(ORG, (tx) => salesHoldings(tx));
    const said = holdings.find((h) => h.ref === quote.output.quoteId);
    expect(said).toMatchObject({ kind: 'quote', holder: { id: 'usr_kofi' }, state: 'held' });
    // In the contract's shape (holding.v1): its source, a holder, never a wait without whom.
    for (const holding of [...holdings, ...(await transaction(ORG, (tx) => purchaseHoldings(tx)))]) {
      const body = holdingBody('prd_kete_finance', holding);
      expect(body).toMatchObject({ source: { app: 'prd_kete_finance' }, holder: { kind: 'person' } });
      expect(String(body.what).length).toBeLessThanOrEqual(300);
      if (body.state === 'waiting') expect(body).toHaveProperty('waiting_on');
    }
  });
});
