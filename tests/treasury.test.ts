import type { KeteIdentity } from '@kete/auth';
import { assignBusinessRole, performGesture, type Caller } from '@kete/capabilities';
import { assertOrganizationIsolation, createTestSchema, type TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { migrations } from '../db/migrations';
import { findInvoice } from '../src/features/sales/infrastructure/sales.table';
import { treasuryStanding } from '../src/features/treasury';
import { reallyAvailable } from '../src/features/treasury/domain/standing';
import {
  closingsOf,
  findAccount,
  movementsOf,
} from '../src/features/treasury/infrastructure/treasury.table';
import { transaction, usePool } from '../src/platform/db';
import { registry } from '../src/platform/registry';
import { asPerson } from '../src/platform/rights';
import { screenActor } from '../src/platform/session';
import { syncCenter } from '../src/platform/sync';

// Spec 003 — treasury. The proof of step G3: « Really available » is the bank less reserved and
// committed; and around it: money lands on its account with the gesture that moves it, the funds
// of each project are its own, a till closed for a day takes nothing more, and nothing leaves a
// till that is not in it.

const ORG = 'org_acme';
const A = 'prj_0000000000000000000000000000000a';
const B = 'prj_0000000000000000000000000000000b';
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
const kofi = person('usr_kofi', 'member', 'Kofi'); // sells
const essi = person('usr_essi', 'member', 'Essi'); // keeps the accounts
const yao = person('usr_yao', 'member', 'Yao'); // holds the till

const onScreen = (identity: KeteIdentity): Caller => ({
  actor: screenActor(identity),
  organizationId: ORG,
});

// The center: two projects Kofi and Ama are of, and no circuit — purchases are decided here.
const project = (projectId: string, name: string) => ({
  projectId,
  name,
  party: null,
  lead: { userId: 'usr_ama', name: 'Ama' },
  status: 'open',
  phase: null,
  sold: null,
  currency: 'XOF',
  team: [
    { userId: 'usr_ama', name: 'Ama', lead: true },
    { userId: 'usr_kofi', name: 'Kofi', lead: false },
  ],
  posts: [{ postId: 'pst_1', name: 'Matériel', budget: 500_000 }],
  budget: 500_000,
});
function fakeCenter(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const path = String(input instanceof Request ? input.url : input).replace(
    'https://api.center.test',
    '',
  );
  const token = new Headers(init?.headers).get('authorization') ?? '';
  const member = token.includes('usr_ama') || token.includes('usr_kofi');
  if (path === `/v1/projects/${A}` && member) {
    return Promise.resolve(Response.json({ project: project(A, 'Clinique Biasa') }));
  }
  if (path === `/v1/projects/${B}` && member) {
    return Promise.resolve(Response.json({ project: project(B, 'École La Colombe') }));
  }
  if (path === '/v1/money/facts') return Promise.resolve(Response.json({ ok: true }));
  if (path.endsWith('/decisions')) {
    return Promise.resolve(Response.json({ error: 'no_circuit' }, { status: 422 }));
  }
  return Promise.resolve(Response.json({ error: 'not_found' }, { status: 404 }));
}

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
const standing = () => transaction(ORG, (tx) => treasuryStanding(tx));
const account = (accountId: string) => transaction(ORG, (tx) => findAccount(tx, accountId));

const today = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const ids = {} as Record<'bank' | 'till' | 'wallet' | 'invoice', string>;

/** A purchase asked by Kofi on a project, approved here by Ama: committed on the project. */
async function committed(projectId: string, amount: number): Promise<string> {
  const asked = done(
    await gesture<{ requestId: string }>(kofi, 'purchases_ask', {
      title: 'Matériel de pose',
      partyName: 'Solartech',
      projectId,
      post: 'Matériel',
      lines: [{ label: 'Lot', quantity: 1, unitPrice: amount }],
    }),
  );
  done(await gesture(ama, 'purchases_decide', { requestId: asked.requestId, decision: 'approve' }));
  return asked.requestId;
}

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

describe('the three states of money', () => {
  it('takes off what is reserved for projects and what is committed, no franc twice', () => {
    // A project's commitments are paid with its own money first.
    expect(
      reallyAvailable(2_650_000, [{ projectId: 'a', received: 600_000, spent: 0, committed: 250_000 }], 0),
    ).toMatchObject({ held: 2_650_000, reserved: 600_000, committed: 0, available: 2_050_000 });
    // What it owes beyond its own money weighs on everyone's.
    expect(
      reallyAvailable(1_000_000, [{ projectId: 'a', received: 100_000, spent: 0, committed: 250_000 }], 40_000),
    ).toMatchObject({ reserved: 100_000, committed: 190_000, available: 710_000 });
    // A project that spent what it did not receive reserves nothing — and is said overdrawn.
    const overdrawn = reallyAvailable(
      500_000,
      [{ projectId: 'b', received: 0, spent: 300_000, committed: 0 }],
      0,
    );
    expect(overdrawn).toMatchObject({ reserved: 0, committed: 0, available: 500_000 });
    expect(overdrawn.projects[0]).toMatchObject({ available: -300_000, overdrawn: 300_000 });
  });
});

describe('« really available » is the bank less reserved and committed', () => {
  it('starts from what the accounts hold', async () => {
    // Who holds the till does not open accounts.
    expect(
      await gesture(yao, 'treasury_open_account', { name: 'Caisse', kind: 'till', openedOn: today }),
    ).toMatchObject({ ok: false, code: 'not_allowed' });
    ids.bank = done(
      await gesture<{ accountId: string }>(ama, 'treasury_open_account', {
        name: 'Ecobank',
        kind: 'bank',
        opening: 2_000_000,
        openedOn: today,
      }),
    ).accountId;
    ids.till = done(
      await gesture<{ accountId: string }>(essi, 'treasury_open_account', {
        name: 'Caisse',
        kind: 'till',
        opening: 50_000,
        openedOn: today,
      }),
    ).accountId;
    expect(await standing()).toMatchObject({
      held: 2_050_000,
      reserved: 0,
      committed: 0,
      available: 2_050_000,
    });
  });

  it('keeps for a project what it received: more in the bank, nothing more to dispose of', async () => {
    const invoice = done(
      await gesture<{ invoiceId: string }>(kofi, 'invoices_create', {
        title: 'Centrale solaire — acompte',
        partyName: 'Clinique Biasa',
        projectId: A,
        taxRate: 0,
        lines: [{ label: 'Acompte', quantity: 1, unitPrice: 1_000_000 }],
      }),
    );
    ids.invoice = invoice.invoiceId;
    done(await gesture(essi, 'invoices_issue', invoice));
    done(
      await gesture(yao, 'receipts_record', {
        ...invoice,
        amount: 600_000,
        receivedOn: today,
        method: 'bank',
        reference: 'VIR 7741',
      }),
    );
    // The money landed on the bank account, with the gesture that received it.
    expect(await account(ids.bank)).toMatchObject({ balance: 2_600_000 });
    const [movement] = await transaction(ORG, (tx) => movementsOf(tx, ids.bank));
    expect(movement).toMatchObject({ direction: 'in', amount: 600_000, projectId: A, method: 'bank' });
    expect(movement?.source).toMatch(/^receipt:rcp_/);
    expect(await standing()).toMatchObject({
      held: 2_650_000,
      reserved: 600_000,
      committed: 0,
      available: 2_050_000,
    });
  });

  it('pays a project’s purchases with the project’s own money first', async () => {
    const requestId = await committed(A, 250_000);
    // Committed, and covered by what the project holds: nothing more is taken off.
    let now = await standing();
    expect(now).toMatchObject({ reserved: 600_000, committed: 0, available: 2_050_000 });
    expect(now.projects.find((p) => p.projectId === A)).toMatchObject({
      received: 600_000,
      committed: 250_000,
      uncovered: 0,
    });
    done(
      await gesture(yao, 'purchases_pay', {
        requestId,
        amount: 250_000,
        paidOn: today,
        method: 'bank',
        reference: 'VIR 7790',
      }),
    );
    now = await standing();
    expect(now).toMatchObject({ held: 2_400_000, reserved: 350_000, committed: 0, available: 2_050_000 });
  });

  it('takes off what the running of the organization owes, then pays it from the till', async () => {
    const note = done(
      await gesture<{ requestId: string }>(essi, 'expenses_file', {
        title: 'Fournitures de bureau',
        spentOn: today,
        lines: [{ label: 'Papier et encre', quantity: 1, unitPrice: 40_000 }],
      }),
    );
    done(await gesture(ama, 'purchases_decide', { ...note, decision: 'approve' }));
    expect(await standing()).toMatchObject({ committed: 40_000, available: 2_010_000 });
    done(
      await gesture(yao, 'purchases_pay', { ...note, amount: 40_000, paidOn: today, method: 'cash' }),
    );
    expect(await account(ids.till)).toMatchObject({ balance: 10_000 });
    expect(await standing()).toMatchObject({
      held: 2_360_000,
      committed: 0,
      available: 2_010_000,
      running: { spent: 40_000, committed: 0 },
    });
  });

  it('says when a project spends the money of others', async () => {
    // Nothing was received for this project: what it commits weighs on everyone's money.
    const requestId = await committed(B, 300_000);
    let now = await standing();
    expect(now).toMatchObject({ reserved: 350_000, committed: 300_000, available: 1_710_000 });
    expect(now.projects.find((p) => p.projectId === B)).toMatchObject({ uncovered: 300_000 });
    done(
      await gesture(yao, 'purchases_pay', { requestId, amount: 300_000, paidOn: today, method: 'bank' }),
    );
    now = await standing();
    // Paid: the money is gone from the bank, and the project is said overdrawn by as much.
    expect(now).toMatchObject({ held: 2_060_000, reserved: 350_000, committed: 0, available: 1_710_000 });
    expect(now.projects.find((p) => p.projectId === B)).toMatchObject({
      available: -300_000,
      overdrawn: 300_000,
    });
    // The other project's money is still its own.
    expect(now.projects.find((p) => p.projectId === A)).toMatchObject({ available: 350_000 });
  });
});

describe('money and its account', () => {
  it('waits to be assigned when no account takes its way of paying', async () => {
    done(
      await gesture(yao, 'receipts_record', {
        invoiceId: ids.invoice,
        amount: 100_000,
        receivedOn: today,
        method: 'mobile',
        reference: 'TMoney 9F2',
      }),
    );
    // Received, but in no balance yet: it shows as missing until it is assigned.
    let now = await standing();
    expect(now).toMatchObject({ held: 2_060_000, unassigned: 1, reserved: 450_000, available: 1_610_000 });
    const [waiting] = await transaction(ORG, (tx) => movementsOf(tx, null));
    ids.wallet = done(
      await gesture<{ accountId: string }>(essi, 'treasury_open_account', {
        name: 'TMoney',
        kind: 'mobile',
        openedOn: today,
      }),
    ).accountId;
    // A mobile payment does not go to a bank account.
    expect(
      await gesture(essi, 'treasury_assign', { movementId: waiting?.movementId, accountId: ids.bank }),
    ).toMatchObject({ ok: false, code: 'account_not_found' });
    done(
      await gesture(essi, 'treasury_assign', { movementId: waiting?.movementId, accountId: ids.wallet }),
    );
    now = await standing();
    expect(now).toMatchObject({ held: 2_160_000, unassigned: 0, available: 1_710_000 });
  });

  it('carries money between accounts, and lets nothing leave a till that is not in it', async () => {
    const carry = (amount: number, toAccountId = ids.bank) =>
      gesture(essi, 'treasury_transfer', { fromAccountId: ids.till, toAccountId, amount, on: today });
    done(await carry(5_000));
    expect(await account(ids.till)).toMatchObject({ balance: 5_000 });
    expect(await account(ids.bank)).toMatchObject({ balance: 2_055_000 });
    expect(await carry(5_001)).toMatchObject({ ok: false, code: 'not_enough_in_account' });
    expect(await carry(1_000, ids.till)).toMatchObject({ ok: false, code: 'same_account' });
    // Held is the same: the money only changed place.
    expect(await standing()).toMatchObject({ held: 2_160_000 });
    // Bank fees: money that went out outside sales and purchases.
    done(
      await gesture(essi, 'treasury_move', {
        accountId: ids.bank,
        direction: 'out',
        amount: 2_500,
        on: today,
        label: 'Frais de tenue de compte',
      }),
    );
    expect(await standing()).toMatchObject({ held: 2_157_500, available: 1_707_500 });
  });
});

describe('the till, closed every day', () => {
  it('writes what was counted against what was expected, as it is', async () => {
    // Who keeps the accounts does not close the till; who holds it does.
    const closing = { accountId: ids.till, closedOn: today, counted: 4_500, note: 'Pièce manquante' };
    expect(await gesture(essi, 'till_close', closing)).toMatchObject({ ok: false, code: 'not_allowed' });
    expect(await gesture(yao, 'till_close', { ...closing, closedOn: tomorrow })).toMatchObject({
      ok: false,
      code: 'day_not_over',
    });
    expect(await gesture(yao, 'till_close', { ...closing, accountId: ids.bank })).toMatchObject({
      ok: false,
      code: 'not_a_till',
    });
    expect(
      done(await gesture<{ expected: number; difference: number }>(yao, 'till_close', closing)),
    ).toMatchObject({ expected: 5_000, difference: -500 });
    expect(await transaction(ORG, (tx) => closingsOf(tx, ids.till))).toEqual([
      expect.objectContaining({
        closedOn: today,
        expected: 5_000,
        counted: 4_500,
        difference: -500,
        note: 'Pièce manquante',
      }),
    ]);
    expect(await gesture(yao, 'till_close', closing)).toMatchObject({
      ok: false,
      code: 'already_closed',
    });
  });

  it('takes nothing more dated that day: the receipt is refused, not lost in a drawer', async () => {
    const cash = { invoiceId: ids.invoice, amount: 50_000, receivedOn: today, method: 'cash' };
    expect(await gesture(yao, 'receipts_record', cash)).toMatchObject({
      ok: false,
      code: 'till_closed',
    });
    // Nothing was written: neither the receipt nor a movement.
    expect(await transaction(ORG, (tx) => findInvoice(tx, ids.invoice))).toMatchObject({
      received: 700_000,
    });
    expect(await account(ids.till)).toMatchObject({ balance: 5_000, closedOn: today });
    // Dated the next day, the till takes it.
    done(await gesture(yao, 'receipts_record', { ...cash, receivedOn: tomorrow }));
    expect(await account(ids.till)).toMatchObject({ balance: 55_000 });
  });
});

describe('who reads the treasury', () => {
  it('answers an agent with every figure computed, and nobody without the right', async () => {
    const read = done(await gesture<Record<string, unknown>>(essi, 'treasury_standing', {}));
    expect(read).toMatchObject({ movementsWaitingForAnAccount: 0 });
    expect(String(read['reallyAvailable'])).toMatch(/XOF$/);
    expect(await gesture(kofi, 'treasury_standing', {})).toMatchObject({
      ok: false,
      code: 'not_allowed',
    });
  });

  it('keeps each organization’s accounts to itself (RLS)', async () => {
    await assertOrganizationIsolation({
      app: db.app,
      table: 'accounts',
      organizations: ['org_x', 'org_y'],
      insert: async (client, organizationId) => {
        await client.query(
          `insert into accounts (account_id, organization_id, name, kind, currency, opened_on, created_by)
           values ($1, $2, 'x', 'bank', 'XOF', current_date, 'usr_x')`,
          [`acc_${organizationId}`, organizationId],
        );
      },
    });
  });
});
