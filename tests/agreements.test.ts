import type { KeteIdentity } from '@kete/auth';
import { assignBusinessRole, performGesture, type Caller } from '@kete/capabilities';
import { createTestSchema, type TestSchema } from '@kete/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { migrations } from '../db/migrations';
import { findRequest, searchRequests } from '../src/features/purchases/infrastructure/purchases.table';
import { transaction, usePool } from '../src/platform/db';
import { registry } from '../src/platform/registry';
import { asPerson } from '../src/platform/rights';
import { screenActor } from '../src/platform/session';

// Spec 004 — the funders' rules. The proof of step I1, on Kete Finance's side: « A funder's
// clause refuses a purchase » — before a request is written on a funded project, Kete Commitments
// is asked, with the person's token; refused, nothing is written and the passage is said.

const ORG = 'org_acme';
const PROJECT = 'prj_0000000000000000000000000000000a';
let db: TestSchema;

const kofi: KeteIdentity = {
  userId: 'usr_kofi',
  email: 'usr_kofi@example.test',
  name: 'Kofi',
  organizationId: ORG,
  role: 'member',
  apps: {},
  twoFactor: false,
  expiresAt: new Date(Date.now() + 60_000),
};

// The center (its project and posts) and Kete Commitments (the funder's rules), as reached.
const commitments = { asked: [] as { token: string; body: Record<string, unknown> }[], away: false };
function fakeServices(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const token = new Headers(init?.headers).get('authorization')?.replace('Bearer ', '') ?? '';
  if (url === `https://api.center.test/v1/projects/${PROJECT}`) {
    return Promise.resolve(
      Response.json({
        project: {
          projectId: PROJECT,
          name: 'Centrale solaire — Clinique Biasa',
          party: null,
          lead: { userId: 'usr_ama', name: 'Ama' },
          status: 'open',
          phase: null,
          sold: null,
          currency: 'XOF',
          team: [],
          posts: [
            { postId: 'p1', name: 'Matériel', budget: 1_530_000 },
            { postId: 'p2', name: 'Transport', budget: 300_000 },
          ],
          budget: 1_830_000,
        },
      }),
    );
  }
  if (url === 'https://commitments.test/api/v1/capabilities/spending_check') {
    if (commitments.away) return Promise.reject(new Error('away'));
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    commitments.asked.push({ token, body });
    const label = String(body['label']).toLowerCase();
    const refused = label.includes('véhicule')
      ? [
          {
            kind: 'excluded_words',
            agreement: 'CONV-FONDS-ER-2026-07',
            clause: 'Art. 5.4 — Sont exclus les véhicules et le carburant.',
            detail: 'véhicule',
          },
        ]
      : [];
    return Promise.resolve(
      Response.json({ status: 'done', output: { allowed: refused.length === 0, refusals: refused, agreements: ['CONV-FONDS-ER-2026-07'] } }),
    );
  }
  // No circuit at the center: requests are decided here.
  return Promise.resolve(Response.json({ error: 'no_circuit' }, { status: 422 }));
}

const ask = (title: string, label: string, post = 'Transport') =>
  performGesture<{ requestId: string }>(
    registry,
    {
      actor: screenActor(kofi),
      organizationId: ORG,
      name: 'purchases_ask',
      input: { title, projectId: PROJECT, post, lines: [{ label, quantity: 1, unitPrice: 150_000 }] },
    } satisfies Caller & { name: string; input: unknown },
    (work) => asPerson(kofi, work, 'usr_kofi-token'),
  );

beforeAll(async () => {
  process.env.ENTERPRISE_API_URL = 'https://api.center.test';
  process.env.COMMITMENTS_API_URL = 'https://commitments.test';
  vi.stubGlobal('fetch', fakeServices);
  db = await createTestSchema({
    migrate: async (owner, context) => {
      for (const migration of migrations) await owner.query(migration.sql(context));
    },
  });
  usePool(db.app);
  await transaction(ORG, (client) => assignBusinessRole(client, ORG, kofi.userId, 'sales'));
});

afterAll(async () => {
  vi.unstubAllGlobals();
  delete process.env.ENTERPRISE_API_URL;
  delete process.env.COMMITMENTS_API_URL;
  await db.drop();
});

describe('a funder’s clause refuses a purchase', () => {
  it('asks Kete Commitments with her token, before anything is written', async () => {
    const allowed = await ask('Transport du matériel', 'Camion plateau, aller simple');
    expect(allowed.ok).toBe(true);
    expect(commitments.asked[0]).toEqual({
      token: 'usr_kofi-token',
      body: {
        projectId: PROJECT,
        post: 'Transport',
        amount: 150_000,
        label: 'Transport du matériel — Camion plateau, aller simple',
        on: new Date().toISOString().slice(0, 10),
      },
    });
    const requestId = allowed.ok ? allowed.output.requestId : '';
    expect(await transaction(ORG, (tx) => findRequest(tx, requestId))).toMatchObject({ agreement: 'allowed' });
  });

  it('refuses what the agreement excludes, writes nothing, and cites the passage', async () => {
    const refused = await ask('Déplacement chantier', 'Location de véhicule 4x4, 3 jours');
    expect(refused).toEqual({
      ok: false,
      code: 'refused_by_agreement',
      facts: {
        agreement: 'CONV-FONDS-ER-2026-07',
        clause: 'Art. 5.4 — Sont exclus les véhicules et le carburant.',
      },
    });
    const written = await transaction(ORG, (tx) => searchRequests(tx, { limit: 10 }));
    expect(written.map((request) => request.title)).toEqual(['Transport du matériel']);
  });

  it('goes on when Kete Commitments cannot be asked, and says it was not checked', async () => {
    commitments.away = true;
    const unchecked = await ask('Déplacement chantier', 'Location de véhicule 4x4, 3 jours');
    expect(unchecked.ok).toBe(true);
    const requestId = unchecked.ok ? unchecked.output.requestId : '';
    expect(await transaction(ORG, (tx) => findRequest(tx, requestId))).toMatchObject({ agreement: 'unchecked' });
    commitments.away = false;
  });

  it('asks nothing for the running of the organization', async () => {
    const before = commitments.asked.length;
    const running = await performGesture(
      registry,
      {
        actor: screenActor(kofi),
        organizationId: ORG,
        name: 'purchases_ask',
        input: { title: 'Ramettes', lines: [{ label: 'Papier', quantity: 5, unitPrice: 3_500 }] },
      },
      (work) => asPerson(kofi, work, 'usr_kofi-token'),
    );
    expect(running.ok).toBe(true);
    expect(commitments.asked.length).toBe(before);
  });
});
