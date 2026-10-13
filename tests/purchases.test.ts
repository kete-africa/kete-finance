import type { KeteIdentity } from '@kete/auth';
import { assignBusinessRole, performGesture, type Caller } from '@kete/capabilities';
import { validateManifest } from '@kete/sdk';
import { assertOrganizationIsolation, createTestSchema, type TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { migrations } from '../db/migrations';
import { decisionOf } from '../src/features/purchases';
import { standingOf, subjectOf } from '../src/features/purchases/domain/purchases';
import {
  findAdvance,
  findRequest,
  pricesOf,
} from '../src/features/purchases/infrastructure/purchases.table';
import { countUntold, listFacts } from '../src/features/register';
import { transaction, usePool } from '../src/platform/db';
import { manifest } from '../src/platform/events';
import { registry } from '../src/platform/registry';
import { asPerson } from '../src/platform/rights';
import { screenActor } from '../src/platform/session';
import { syncCenter } from '../src/platform/sync';

// Spec 002 — purchases and expenses. The proof of step G2: « A request beyond its post goes up
// the circuit »; and around it: who asks never approves nor pays, a request sent back is the same
// request corrected, an advance is justified to the unit, and every franc lands on its post.

const ORG = 'org_acme';
const PROJECT = 'prj_00000000000000000000000000000001';
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

const ama = person('usr_ama', 'owner', 'Ama');
const kofi = person('usr_kofi', 'member', 'Kofi'); // sells, and works on the project
const kossi = person('usr_kossi', 'member', 'Kossi'); // buys
const essi = person('usr_essi', 'member', 'Essi'); // keeps the accounts
const yao = person('usr_yao', 'member', 'Yao'); // holds the till

const onScreen = (identity: KeteIdentity): Caller => ({
  actor: screenActor(identity),
  organizationId: ORG,
});

// The center, as the app's client reaches it: its project, its circuits, what it was asked.
const center = {
  team: ['usr_ama', 'usr_kofi'],
  circuits: new Set(['purchase', 'beyond_budget']),
  asked: [] as Record<string, unknown>[],
  requests: new Map<string, string>(), // reference -> the center's request
  decisions: new Map<string, { status: string; decidedBy: string | null; reason: string | null }>(),
  facts: new Map<string, Record<string, unknown>>(),
};
const project = {
  projectId: PROJECT,
  name: 'Centrale solaire 12 kWc',
  party: null,
  lead: { userId: 'usr_ama', name: 'Ama' },
  status: 'open',
  phase: null,
  sold: 2_926_400,
  currency: 'XOF',
  team: [
    { userId: 'usr_ama', name: 'Ama', lead: true },
    { userId: 'usr_kofi', name: 'Kofi', lead: false },
  ],
  posts: [
    { postId: 'pst_1', name: 'Matériel', budget: 1_530_000 },
    { postId: 'pst_2', name: 'Main-d’œuvre', budget: 250_000 },
  ],
  budget: 1_780_000,
};

function fakeCenter(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const path = url.replace('https://api.center.test', '');
  const token = new Headers(init?.headers).get('authorization')?.replace('Bearer ', '') ?? '';
  const userId = token.replace('-token', '');
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  const no = (error: string, status: number) => Promise.resolve(Response.json({ error }, { status }));

  if (path === `/v1/projects/${PROJECT}`) {
    return center.team.includes(userId)
      ? Promise.resolve(Response.json({ project }))
      : no('not_found', 404);
  }
  if (path === '/v1/apps/prd_kete_gestion/decisions' && init?.method === 'POST') {
    center.asked.push({ ...body, by: userId });
    const subject = String(body['subject']);
    if (!center.circuits.has(subject)) return no('no_circuit', 422);
    const reference = String(body['reference']);
    const requestId = center.requests.get(reference) ?? `drq_${center.requests.size + 1}`;
    center.requests.set(reference, requestId);
    center.decisions.set(requestId, { status: 'pending', decidedBy: null, reason: null });
    return Promise.resolve(Response.json({ requestId, status: 'pending' }, { status: 201 }));
  }
  const read = /^\/public\/apps\/org_acme\/decisions\/(drq_\d+)$/.exec(path);
  if (read?.[1]) {
    const decision = center.decisions.get(read[1]);
    return decision && token === 'app-token'
      ? Promise.resolve(Response.json({ requestId: read[1], subject: '', reference: '', ...decision }))
      : no('not_found', 404);
  }
  if (path === '/v1/money/facts' && init?.method === 'POST') {
    const fact = body['fact'] as Record<string, unknown>;
    center.facts.set(String(fact['key']), fact);
    return Promise.resolve(Response.json({ ok: true }));
  }
  return no('not_found', 404);
}

/** A person's gesture, as her screen makes it: the capability, then the center hears of it. */
async function gesture<T = Record<string, unknown>>(
  who: KeteIdentity,
  name: string,
  input: unknown,
) {
  const caller = onScreen(who);
  const token = `${who.userId}-token`;
  const outcome = await performGesture<T>(registry, { ...caller, name, input }, (work) =>
    asPerson(who, work, token),
  );
  if (outcome.ok) await syncCenter(token, caller);
  return outcome;
}
const done = <T>(outcome: { ok: true; output: T } | { ok: false; code: string }): T => {
  if (!outcome.ok) throw new Error(`refused: ${outcome.code}`);
  return outcome.output;
};
const request = (requestId: string) => transaction(ORG, (tx) => findRequest(tx, requestId));
/** The center decides one of its requests, and tells the app — which reads it as itself. */
async function centerDecides(
  requestId: string,
  decision: { status: string; decidedBy: string; reason?: string },
) {
  const asked = center.requests.get(requestId) ?? '';
  center.decisions.set(asked, { reason: null, ...decision });
  return decisionOf('app-token', ORG, asked);
}

const year = new Date().getUTCFullYear();
const onProject = { projectId: PROJECT, post: 'Matériel' };
const ids = {} as Record<'cables' | 'inverter' | 'note' | 'advance' | 'trip', string>;

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
    await assignBusinessRole(client, ORG, kossi.userId, 'buyer');
    await assignBusinessRole(client, ORG, essi.userId, 'accountant');
    await assignBusinessRole(client, ORG, yao.userId, 'cashier');
  });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  delete process.env.ENTERPRISE_API_URL;
  await db.drop();
});

describe('where a request stands against its post', () => {
  it('counts what the post has left, and by how much a request goes beyond', () => {
    expect(standingOf(1_530_000, 120_000, 1_500_000)).toEqual({
      budget: 1_530_000,
      left: 1_410_000,
      beyondBy: 90_000,
    });
    expect(standingOf(1_530_000, 120_000, 1_410_000).beyondBy).toBe(0);
    // A post already overrun has nothing left: the whole request is beyond.
    expect(standingOf(250_000, 300_000, 40_000)).toMatchObject({ left: -50_000, beyondBy: 40_000 });
    // A post the budget does not have.
    expect(standingOf(null, 0, 75_000)).toEqual({ budget: 0, left: 0, beyondBy: 75_000 });
  });

  it('sends what goes beyond to its own circuit, whatever it buys', () => {
    expect(subjectOf('purchase', 0)).toBe('purchase');
    expect(subjectOf('expense', 0)).toBe('expense');
    expect(subjectOf('purchase', 1)).toBe('beyond_budget');
    expect(subjectOf('expense', 90_000)).toBe('beyond_budget');
  });
});

describe('a request within its post', () => {
  it('is asked on a project and a post, and goes to the ordinary circuit with its project', async () => {
    const asked = done(
      await gesture<{ requestId: string; number: string; amount: number; beyondBy: number }>(
        kofi,
        'purchases_ask',
        {
          title: 'Câbles et protections',
          partyName: 'Solartech',
          ...onProject,
          lines: [{ label: 'Câble solaire 6 mm² (100 m)', quantity: 2, unitPrice: 60_000 }],
        },
      ),
    );
    ids.cables = asked.requestId;
    expect(asked).toMatchObject({ number: `DA-${year}-0001`, amount: 120_000, beyondBy: 0 });
    expect(center.asked.at(-1)).toMatchObject({
      subject: 'purchase',
      reference: ids.cables,
      measure: 120_000,
      projectId: PROJECT,
      by: 'usr_kofi',
    });
    expect(await request(ids.cables)).toMatchObject({
      status: 'asked',
      route: 'center',
      requester: { userId: 'usr_kofi', name: 'Kofi' },
      projectName: 'Centrale solaire 12 kWc',
      standing: { budget: 1_530_000, left: 1_530_000, beyondBy: 0 },
    });
    // Nothing is committed while nobody decided.
    expect(await transaction(ORG, (tx) => listFacts(tx, { projectId: PROJECT }))).toEqual([]);
  });

  it('is never decided here while the center’s circuit decides it', async () => {
    expect(
      await gesture(ama, 'purchases_decide', { requestId: ids.cables, decision: 'approve' }),
    ).toMatchObject({ ok: false, code: 'decided_at_the_center' });
  });

  it('commits its amount on its post once the center approves', async () => {
    expect(await centerDecides(ids.cables, { status: 'approved', decidedBy: 'Ama' })).toBe(true);
    expect(await request(ids.cables)).toMatchObject({
      status: 'approved',
      decided: { by: 'Ama' },
    });
    // The center told the app, not a person: the fact waits for the next gesture.
    expect(await transaction(ORG, (tx) => countUntold(tx))).toBe(1);
    // Told twice, it is applied once.
    expect(await centerDecides(ids.cables, { status: 'approved', decidedBy: 'Ama' })).toBe(false);
  });
});

describe('a request beyond its post goes up the circuit', () => {
  it('takes the circuit of what goes beyond the budget, and says by how much', async () => {
    const asked = done(
      await gesture<{ requestId: string; beyondBy: number }>(kofi, 'purchases_ask', {
        title: 'Onduleur de remplacement',
        partyName: 'Solartech',
        ...onProject,
        lines: [{ label: 'Onduleur hybride 10 kVA', quantity: 1, unitPrice: 1_500_000 }],
      }),
    );
    ids.inverter = asked.requestId;
    // 1 530 000 of budget, 120 000 committed: 1 410 000 left — 90 000 beyond.
    expect(asked.beyondBy).toBe(90_000);
    expect(await request(ids.inverter)).toMatchObject({
      route: 'center',
      standing: { budget: 1_530_000, left: 1_410_000, beyondBy: 90_000 },
    });
    const sent = center.asked.at(-1);
    expect(sent).toMatchObject({ subject: 'beyond_budget', measure: 1_500_000, projectId: PROJECT });
    expect(String(sent?.['title'])).toContain('Matériel');
    // The gesture that followed told the center what the cables commit, on their post.
    expect(center.facts.get(`purchase:${ids.cables}`)).toMatchObject({
      kind: 'committed',
      amount: 120_000,
      project_id: PROJECT,
      post: 'Matériel',
    });
  });

  it('counts what is asked and waits: the next request on the post is beyond in full', async () => {
    const next = done(
      await gesture<{ requestId: string; beyondBy: number }>(kofi, 'purchases_ask', {
        title: 'Visserie',
        ...onProject,
        lines: [{ label: 'Lot de visserie inox', quantity: 1, unitPrice: 20_000 }],
      }),
    );
    expect(next.beyondBy).toBe(20_000);
    expect(center.asked.at(-1)).toMatchObject({ subject: 'beyond_budget' });
    // Refused at the center: it no longer weighs on the post.
    await centerDecides(next.requestId, { status: 'refused', decidedBy: 'Ama', reason: 'En stock.' });
    expect(await request(next.requestId)).toMatchObject({
      status: 'refused',
      decided: { by: 'Ama', reason: 'En stock.' },
    });
  });

  it('is sent back, corrected by who asked, and decided — the same request', async () => {
    await centerDecides(ids.inverter, {
      status: 'returned',
      decidedBy: 'Ama',
      reason: 'Négociez le prix.',
    });
    expect(await request(ids.inverter)).toMatchObject({
      status: 'returned',
      decided: { reason: 'Négociez le prix.' },
    });
    const corrected = {
      requestId: ids.inverter,
      title: 'Onduleur de remplacement',
      partyName: 'Solartech',
      ...onProject,
      lines: [{ label: 'Onduleur hybride 10 kVA', quantity: 1, unitPrice: 1_400_000 }],
    };
    // Only who asked corrects it.
    expect(await gesture(ama, 'purchases_correct', corrected)).toMatchObject({
      ok: false,
      code: 'not_the_requester',
    });
    expect(done(await gesture<{ beyondBy: number }>(kofi, 'purchases_correct', corrected))).toMatchObject(
      { amount: 1_400_000, beyondBy: 0 },
    );
    // Asked again under the same reference and the same subject: the center's same request.
    expect(center.asked.at(-1)).toMatchObject({
      subject: 'beyond_budget',
      reference: ids.inverter,
      measure: 1_400_000,
    });
    expect(center.requests.size).toBe(3);
    await centerDecides(ids.inverter, { status: 'approved', decidedBy: 'Ama' });
    expect(await request(ids.inverter)).toMatchObject({ status: 'approved', amount: 1_400_000 });
  });

  it('falls back on the ordinary circuit when the organization has none for what goes beyond', async () => {
    center.circuits.delete('beyond_budget');
    const before = center.asked.length;
    const asked = done(
      await gesture<{ requestId: string; beyondBy: number }>(kofi, 'purchases_ask', {
        title: 'Échafaudage',
        ...onProject,
        lines: [{ label: 'Location échafaudage', quantity: 1, unitPrice: 50_000 }],
      }),
    );
    // 120 000 + 1 400 000 committed: 10 000 left.
    expect(asked.beyondBy).toBe(40_000);
    expect(center.asked.slice(before).map((one) => one['subject'])).toEqual([
      'beyond_budget',
      'purchase',
    ]);
    expect(await request(asked.requestId)).toMatchObject({ route: 'center' });
    await centerDecides(asked.requestId, { status: 'refused', decidedBy: 'Ama' });
    center.circuits.add('beyond_budget');
  });

  it('refuses who is not of the project, and a project without its post', async () => {
    expect(
      await gesture(yao, 'purchases_ask', {
        title: 'Gants',
        ...onProject,
        lines: [{ label: 'Gants', quantity: 5, unitPrice: 2_000 }],
      }),
    ).toMatchObject({ ok: false, code: 'not_of_project' });
    expect(
      await gesture(kofi, 'purchases_ask', {
        title: 'Gants',
        projectId: PROJECT,
        lines: [{ label: 'Gants', quantity: 5, unitPrice: 2_000 }],
      }),
    ).toMatchObject({ ok: false, code: 'post_required' });
  });
});

describe('without a circuit, the app’s own rule', () => {
  it('lets who may approve decide — never who asked', async () => {
    const note = done(
      await gesture<{ requestId: string; number: string }>(essi, 'expenses_file', {
        title: 'Timbres fiscaux',
        spentOn: `${year}-10-12`,
        proof: 'Reçu n° 4471',
        lines: [{ label: 'Timbres', quantity: 3, unitPrice: 5_000 }],
      }),
    );
    ids.note = note.requestId;
    expect(note.number).toBe(`NF-${year}-0001`);
    // The organization has no circuit for expense notes: it is decided here.
    expect(await request(ids.note)).toMatchObject({ route: 'here', status: 'asked', projectId: null });
    expect(
      await gesture(essi, 'purchases_decide', { requestId: ids.note, decision: 'approve' }),
    ).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(
      await gesture(ama, 'purchases_decide', { requestId: ids.note, decision: 'return' }),
    ).toMatchObject({ ok: false, code: 'reason_required' });
    done(await gesture(ama, 'purchases_decide', { requestId: ids.note, decision: 'approve' }));
    expect(await request(ids.note)).toMatchObject({ status: 'approved', decided: { by: 'Ama' } });
    // The running of the organization: a fact without a project.
    const fact = center.facts.get(`purchase:${ids.note}`);
    expect(fact).toMatchObject({ kind: 'committed', amount: 15_000 });
    expect(fact).not.toHaveProperty('project_id');

    const own = done(
      await gesture<{ requestId: string }>(ama, 'expenses_file', {
        title: 'Déjeuner client',
        spentOn: `${year}-10-12`,
        lines: [{ label: 'Repas', quantity: 1, unitPrice: 22_000 }],
      }),
    );
    expect(
      await gesture(ama, 'purchases_decide', { requestId: own.requestId, decision: 'approve' }),
    ).toMatchObject({ ok: false, code: 'own_request' });
  });
});

describe('ordering and paying', () => {
  it('orders an approved purchase with its supplier, numbered', async () => {
    expect(await gesture(kofi, 'purchases_order', { requestId: ids.inverter })).toMatchObject({
      ok: false,
      code: 'not_allowed',
    });
    expect(
      done(await gesture<{ orderNumber: string }>(kossi, 'purchases_order', { requestId: ids.inverter }))
        .orderNumber,
    ).toBe(`BC-${year}-0001`);
    expect(await request(ids.inverter)).toMatchObject({ status: 'ordered', partyName: 'Solartech' });
    // An expense note is not ordered.
    expect(await gesture(kossi, 'purchases_order', { requestId: ids.note })).toMatchObject({
      ok: false,
      code: 'request_not_approved',
    });
  });

  it('pays with a proof, never beyond what is owed, never by who asked', async () => {
    const paid = {
      requestId: ids.cables,
      amount: 120_000,
      paidOn: `${year}-10-13`,
      method: 'bank',
      reference: 'VIR 8812',
    };
    expect(await gesture(kofi, 'purchases_pay', paid)).toMatchObject({
      ok: false,
      code: 'not_allowed',
    });
    expect(await gesture(yao, 'purchases_pay', { ...paid, amount: 120_001 })).toMatchObject({
      ok: false,
      code: 'more_than_owed',
    });
    const payment = done(await gesture<{ paymentId: string; owed: number }>(yao, 'purchases_pay', paid));
    expect(payment.owed).toBe(0);
    expect(await request(ids.cables)).toMatchObject({ status: 'paid', paid: 120_000 });
    // What went out, on its post; and nothing is committed any more.
    expect(center.facts.get(`payment:${payment.paymentId}`)).toMatchObject({
      kind: 'spent',
      amount: 120_000,
      project_id: PROJECT,
      post: 'Matériel',
      occurred_on: `${year}-10-13`,
    });
    expect(center.facts.get(`purchase:${ids.cables}`)).toMatchObject({ kind: 'committed', amount: 0 });
    // Essi keeps the accounts and may pay — but not her own note.
    const own = { requestId: ids.note, amount: 15_000, paidOn: `${year}-10-13`, method: 'cash' };
    expect(await gesture(essi, 'purchases_pay', own)).toMatchObject({ ok: false, code: 'own_request' });
    done(await gesture(yao, 'purchases_pay', own));
  });
});

describe('an advance', () => {
  it('is given with its proof, justified by a note on its post, and the rest brought back', async () => {
    const given = done(
      await gesture<{ advanceId: string; number: string }>(yao, 'advances_give', {
        holderId: kofi.userId,
        holderName: 'Kofi',
        purpose: 'Déplacement chantier Biasa',
        projectId: PROJECT,
        amount: 50_000,
        givenOn: `${year}-10-13`,
        method: 'cash',
        reference: 'Reçu signé',
      }),
    );
    ids.advance = given.advanceId;
    expect(given.number).toBe(`AV-${year}-0001`);
    // Money out, not yet an expense on a post.
    expect(center.facts.get(`advance:${ids.advance}`)).toMatchObject({
      kind: 'spent',
      amount: 50_000,
      project_id: PROJECT,
    });

    const trip = {
      title: 'Transport et repas chantier',
      spentOn: `${year}-10-14`,
      projectId: PROJECT,
      post: 'main-d’œuvre',
      advanceId: ids.advance,
      lines: [
        { label: 'Taxi aller-retour', quantity: 2, unitPrice: 6_000 },
        { label: 'Repas', quantity: 2, unitPrice: 3_000 },
      ],
    };
    // Not another person's advance, and never more than it holds.
    expect(await gesture(essi, 'expenses_file', { ...trip, projectId: undefined, post: undefined })).toMatchObject({
      ok: false,
      code: 'not_the_holder',
    });
    expect(
      await gesture(kofi, 'expenses_file', {
        ...trip,
        lines: [{ label: 'Hôtel', quantity: 1, unitPrice: 60_000 }],
      }),
    ).toMatchObject({ ok: false, code: 'more_than_advance' });
    const note = done(await gesture<{ requestId: string }>(kofi, 'expenses_file', trip));
    ids.trip = note.requestId;
    done(await gesture(ama, 'purchases_decide', { requestId: ids.trip, decision: 'approve' }));

    // Approved, it is settled at once: the advance paid it. The post is the budget's own spelling.
    expect(await request(ids.trip)).toMatchObject({
      status: 'paid',
      paid: 18_000,
      post: 'Main-d’œuvre',
    });
    expect(center.facts.get(`expense:${ids.trip}`)).toMatchObject({
      kind: 'spent',
      amount: 18_000,
      post: 'Main-d’œuvre',
      occurred_on: `${year}-10-14`,
    });
    // The same francs are not counted twice: the advance now says what is left to justify.
    expect(center.facts.get(`advance:${ids.advance}`)).toMatchObject({ amount: 32_000 });

    expect(
      await gesture(yao, 'advances_return', {
        advanceId: ids.advance,
        amount: 32_001,
        returnedOn: `${year}-10-15`,
      }),
    ).toMatchObject({ ok: false, code: 'more_than_advance' });
    done(
      await gesture(yao, 'advances_return', {
        advanceId: ids.advance,
        amount: 32_000,
        returnedOn: `${year}-10-15`,
      }),
    );
    expect(await transaction(ORG, (tx) => findAdvance(tx, ids.advance))).toMatchObject({
      status: 'closed',
      justified: 18_000,
      returned: 32_000,
    });
    expect(center.facts.get(`advance:${ids.advance}`)).toMatchObject({ amount: 0 });
  });
});

describe('what the project spent, post by post', () => {
  it('adds up in the register to what was committed and paid, to the unit', async () => {
    const facts = await transaction(ORG, (tx) => listFacts(tx, { projectId: PROJECT }));
    const by = (kind: string, post: string | null) =>
      facts.filter((f) => f.kind === kind && f.post === post).reduce((sum, f) => sum + f.amount, 0);
    expect(by('spent', 'Matériel')).toBe(120_000);
    expect(by('committed', 'Matériel')).toBe(1_400_000);
    expect(by('spent', 'Main-d’œuvre')).toBe(18_000);
    // The advance is settled: nothing is left outside a post.
    expect(by('spent', null)).toBe(0);
    expect(await transaction(ORG, (tx) => countUntold(tx))).toBe(0);
  });
});

describe('the memory of prices, and who reads what', () => {
  it('recalls what a thing was last bought for, and from whom', async () => {
    const prices = await transaction(ORG, (tx) => pricesOf(tx, 'onduleur'));
    expect(prices[0]).toMatchObject({
      label: 'Onduleur hybride 10 kVA',
      unitPrice: 1_400_000,
      supplier: 'Solartech',
    });
    // A refused request teaches no price.
    expect(await transaction(ORG, (tx) => pricesOf(tx, 'visserie'))).toEqual([]);
  });

  it('shows a requester her own requests, and everyone’s to who reads them all', async () => {
    const listed = async (who: KeteIdentity) =>
      done(await gesture<{ number: string }[]>(who, 'purchase_list', {})).map((r) => r.number);
    expect(await listed(essi)).toHaveLength(7);
    const hers = await listed(kofi);
    expect(hers).toHaveLength(5);
    expect(hers).not.toContain(`NF-${year}-0001`);
    // Another's request is not hers to open.
    expect(done(await gesture(kofi, 'purchase_get', { requestId: ids.note }))).toBeNull();
  });
});

describe('the organization is the boundary', () => {
  it('keeps each organization’s requests and advances to itself (RLS)', async () => {
    await assertOrganizationIsolation({
      app: db.app,
      table: 'purchase_requests',
      organizations: ['org_x', 'org_y'],
      insert: async (client, organizationId) => {
        await client.query(
          `insert into purchase_requests (request_id, organization_id, number, kind, title,
                                          requester_id, requester_name, currency, amount)
           values ($1, $2, 'DA-1', 'purchase', 'x', 'usr_x', 'x', 'XOF', 1)`,
          [`pur_${organizationId}`, organizationId],
        );
      },
    });
    await assertOrganizationIsolation({
      app: db.app,
      table: 'advances',
      organizations: ['org_x', 'org_y'],
      insert: async (client, organizationId) => {
        await client.query(
          `insert into advances (advance_id, organization_id, number, holder_id, holder_name,
                                 purpose, currency, amount, given_on, method, given_by)
           values ($1, $2, 'AV-1', 'usr_x', 'x', 'x', 'XOF', 1, current_date, 'cash', 'usr_x')`,
          [`adv_${organizationId}`, organizationId],
        );
      },
    });
  });
});

describe('what the app says about itself', () => {
  it('declares what it asks the center to decide, and its events', () => {
    const card = manifest();
    expect(validateManifest(card).ok).toBe(true);
    expect(card.subjects?.map((s) => s.name)).toEqual(['purchase', 'expense', 'beyond_budget']);
    expect(card.subjects?.[2]?.label.fr).toBeTruthy();
    expect(card.emits?.map((e) => e.type)).toEqual(
      expect.arrayContaining(['purchase.asked', 'purchase.approved', 'purchase.paid']),
    );
    expect(card.capabilities?.map((c) => c.name)).toEqual(
      expect.arrayContaining(['purchases_ask', 'expenses_file', 'purchases_pay', 'prices_recall']),
    );
  });
});
