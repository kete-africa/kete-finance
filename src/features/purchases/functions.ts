import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { currencyIn } from '@/features/register';
import { getCenter } from '@/platform/center';
import { transaction } from '@/platform/db';
import { centerAppToken } from '@/platform/events';
import { holds } from '@/platform/rights';
import { perform, ScreenError, signedIn } from '@/platform/screen';
import {
  findRequest,
  knownPeople,
  knownProjects,
  listAdvances,
  pricesOf,
  purchasesStanding,
  searchRequests,
} from './infrastructure/purchases.table';
import {
  advanceInput,
  advanceReturnInput,
  correctionInput,
  decideInput,
  expenseInput,
  orderInput,
  paymentInput,
  purchaseInput,
  requestRef,
} from './purchase.record';
import { readDecision } from './route';

// The screens of purchases and expenses. Anyone who may ask reads her own requests; reading
// everyone's, approving here, ordering and paying each show only to who may.

const answer = <T>(
  outcome:
    | { ok: true; output: T }
    | { ok: false; code: string; facts?: Record<string, string | number> },
) =>
  outcome.ok
    ? { ok: true as const, output: outcome.output }
    : { ok: false as const, code: outcome.code, facts: outcome.facts ?? {} };

const may = () => ({
  ask: holds('purchases:ask'),
  readAll: holds('purchases:read'),
  approve: holds('purchases:approve'),
  order: holds('purchases:order'),
  pay: holds('purchases:pay'),
});

async function asking<T>(
  work: (context: { organizationId: string; userId: string; token: string | null }) => Promise<T>,
): Promise<T> {
  const { caller, identity, as, token } = await signedIn();
  return as(async () => {
    if (!holds('purchases:ask')) throw new ScreenError('forbidden');
    return work({ organizationId: caller.organizationId, userId: identity.userId, token });
  });
}

export const fetchPurchasesHome = createServerFn({ method: 'GET' }).handler(() =>
  asking(({ organizationId, userId }) =>
    transaction(organizationId, async (db) => {
      const rights = may();
      const all = rights.readAll;
      return {
        currency: await currencyIn(db, organizationId),
        connected: getCenter().connected,
        may: rights,
        standing: await purchasesStanding(db, all ? undefined : userId),
        requests: await searchRequests(db, { requesterId: all ? undefined : userId, limit: 100 }),
        // What waits for a gesture she may make.
        toDecide: rights.approve
          ? (await searchRequests(db, { statuses: ['asked'], route: 'here', limit: 50 })).filter(
              (request) => request.requester.userId !== userId,
            )
          : [],
        toOrder: rights.order
          ? (await searchRequests(db, { statuses: ['approved'], limit: 50 })).filter(
              (request) => request.kind === 'purchase',
            )
          : [],
        toPay: rights.pay
          ? await searchRequests(db, { statuses: ['approved', 'ordered'], limit: 50 })
          : [],
      };
    }),
  ),
);

export const fetchRequest = createServerFn({ method: 'GET' })
  .validator((input: unknown) => requestRef.parse(input))
  .handler(({ data }) =>
    asking(async ({ organizationId, userId }) => {
      // A request that waits at the center may have been decided since: the app asks, as itself.
      await readDecision(await centerAppToken(), organizationId, data.requestId).catch(
        () => false,
      );
      const rights = may();
      const request = await transaction(organizationId, (db) => findRequest(db, data.requestId));
      const visible =
        request &&
        (request.requester.userId === userId ||
          rights.readAll ||
          rights.approve ||
          rights.order ||
          rights.pay);
      return {
        request: visible ? request : null,
        mine: request?.requester.userId === userId,
        may: rights,
      };
    }),
  );

/** What a request's form starts from: her projects with their posts, and her open advances. */
export const fetchRequestForm = createServerFn({ method: 'GET' }).handler(() =>
  asking(async ({ organizationId, userId, token }) => {
    const projects = (await getCenter().projects(token))
      .filter((project) => project.status === 'open')
      .map((project) => ({
        projectId: project.projectId,
        name: project.name,
        posts: project.posts.map((post) => ({ name: post.name, budget: post.budget })),
      }));
    const [advances, currency] = await transaction(organizationId, (db) =>
      Promise.all([
        listAdvances(db, { holderId: userId, open: true }),
        currencyIn(db, organizationId),
      ]),
    );
    return { currency, connected: getCenter().connected, projects, advances };
  }),
);

/** The suppliers of the center matching a few letters. */
export const searchSuppliers = createServerFn({ method: 'GET' })
  .validator((input: unknown) => z.object({ text: z.string().trim().max(80) }).parse(input))
  .handler(({ data }) =>
    asking(async ({ token }) => {
      const parties = await getCenter().parties(token, data.text || undefined);
      return parties.slice(0, 12).map((party) => ({ partyId: party.partyId, name: party.name }));
    }),
  );

/** The memory of prices, for a line being typed. */
export const recallPrices = createServerFn({ method: 'GET' })
  .validator((input: unknown) => z.object({ text: z.string().trim().min(2).max(100) }).parse(input))
  .handler(({ data }) =>
    asking(({ organizationId }) => transaction(organizationId, (db) => pricesOf(db, data.text, 3))),
  );

export const askPurchase = createServerFn({ method: 'POST' })
  .validator((input: unknown) => purchaseInput.parse(input))
  .handler(async ({ data }) =>
    answer(await perform<{ requestId: string }>('purchases_ask', data)),
  );

export const fileExpense = createServerFn({ method: 'POST' })
  .validator((input: unknown) => expenseInput.parse(input))
  .handler(async ({ data }) =>
    answer(await perform<{ requestId: string }>('expenses_file', data)),
  );

export const correctRequest = createServerFn({ method: 'POST' })
  .validator((input: unknown) => correctionInput.parse(input))
  .handler(async ({ data }) =>
    answer(await perform<{ requestId: string }>('purchases_correct', data)),
  );

export const decideRequest = createServerFn({ method: 'POST' })
  .validator((input: unknown) => decideInput.parse(input))
  .handler(async ({ data }) =>
    answer(await perform<{ requestId: string }>('purchases_decide', data)),
  );

export const orderPurchase = createServerFn({ method: 'POST' })
  .validator((input: unknown) => orderInput.parse(input))
  .handler(async ({ data }) =>
    answer(await perform<{ requestId: string }>('purchases_order', data)),
  );

export const payRequest = createServerFn({ method: 'POST' })
  .validator((input: unknown) => paymentInput.parse(input))
  .handler(async ({ data }) => answer(await perform<{ owed: number }>('purchases_pay', data)));

export const fetchAdvances = createServerFn({ method: 'GET' }).handler(() =>
  asking(async ({ organizationId, userId, token }) => {
    const rights = may();
    const team = (await getCenter().projects(token))
      .filter((project) => project.status === 'open')
      .map((project) => ({
        projectId: project.projectId,
        name: project.name,
        team: project.team.map((person) => ({ userId: person.userId, name: person.name })),
      }));
    return transaction(organizationId, async (db) => ({
      currency: await currencyIn(db, organizationId),
      may: rights,
      advances: await listAdvances(db, rights.readAll || rights.pay ? {} : { holderId: userId }),
      // Her projects at the center, with their team — and those this app already knows.
      projects: [
        ...team,
        ...(await knownProjects(db))
          .filter((known) => !team.some((one) => one.projectId === known.projectId))
          .map((known) => ({ ...known, team: [] as { userId: string; name: string }[] })),
      ],
      // Who already asked or held something here: an advance outside a project names one of them.
      people: await knownPeople(db),
    }));
  }),
);

export const giveAdvance = createServerFn({ method: 'POST' })
  .validator((input: unknown) => advanceInput.parse(input))
  .handler(async ({ data }) =>
    answer(await perform<{ advanceId: string }>('advances_give', data)),
  );

export const returnAdvance = createServerFn({ method: 'POST' })
  .validator((input: unknown) => advanceReturnInput.parse(input))
  .handler(async ({ data }) =>
    answer(await perform<{ outstanding: number }>('advances_return', data)),
  );
