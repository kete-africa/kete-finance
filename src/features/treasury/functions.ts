import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { knownProjects } from '@/features/purchases';
import { CURRENCY } from '@/features/register';
import { transaction } from '@/platform/db';
import { holds } from '@/platform/rights';
import { perform, ScreenError, signedIn } from '@/platform/screen';
import {
  closingsOf,
  findAccount,
  listAccounts,
  movementsOf,
} from './infrastructure/treasury.table';
import { treasuryStanding } from './standing';
import {
  accountInput,
  assignInput,
  closingInput,
  movementInput,
  transferInput,
} from './treasury.record';

// The screens of the treasury: where the money stands, each account and its movements, a till's
// closing. Every figure is computed on the server.

const answer = <T>(outcome: { ok: true; output: T } | { ok: false; code: string }) =>
  outcome.ok
    ? { ok: true as const, output: outcome.output }
    : { ok: false as const, code: outcome.code };

const may = () => ({ manage: holds('treasury:manage'), close: holds('treasury:close') });

async function reading<T>(work: (organizationId: string) => Promise<T>): Promise<T> {
  const { caller, as } = await signedIn();
  return as(async () => {
    if (!holds('treasury:read')) throw new ScreenError('forbidden');
    return work(caller.organizationId);
  });
}

export const fetchTreasury = createServerFn({ method: 'GET' }).handler(() =>
  reading((organizationId) =>
    transaction(organizationId, async (db) => {
      const standing = await treasuryStanding(db);
      const names = new Map((await knownProjects(db)).map((p) => [p.projectId, p.name]));
      return {
        currency: CURRENCY,
        may: may(),
        ...standing,
        projects: standing.projects.map((project) => ({
          ...project,
          name: names.get(project.projectId) ?? project.projectId,
        })),
        waiting: standing.unassigned > 0 ? await movementsOf(db, null, 50) : [],
      };
    }),
  ),
);

export const fetchAccount = createServerFn({ method: 'GET' })
  .validator((input: unknown) => z.object({ accountId: z.string().min(1).max(64) }).parse(input))
  .handler(({ data }) =>
    reading((organizationId) =>
      transaction(organizationId, async (db) => ({
        currency: CURRENCY,
        may: may(),
        account: await findAccount(db, data.accountId),
        accounts: await listAccounts(db),
        movements: await movementsOf(db, data.accountId),
        closings: await closingsOf(db, data.accountId),
      })),
    ),
  );

export const openAccount = createServerFn({ method: 'POST' })
  .validator((input: unknown) => accountInput.parse(input))
  .handler(async ({ data }) =>
    answer(await perform<{ accountId: string }>('treasury_open_account', data)),
  );

export const recordMovement = createServerFn({ method: 'POST' })
  .validator((input: unknown) => movementInput.parse(input))
  .handler(async ({ data }) =>
    answer(await perform<{ movementId: string }>('treasury_move', data)),
  );

export const transferMoney = createServerFn({ method: 'POST' })
  .validator((input: unknown) => transferInput.parse(input))
  .handler(async ({ data }) =>
    answer(await perform<{ transfer: string }>('treasury_transfer', data)),
  );

export const assignMovement = createServerFn({ method: 'POST' })
  .validator((input: unknown) => assignInput.parse(input))
  .handler(async ({ data }) =>
    answer(await perform<{ movementId: string }>('treasury_assign', data)),
  );

export const closeTill = createServerFn({ method: 'POST' })
  .validator((input: unknown) => closingInput.parse(input))
  .handler(async ({ data }) =>
    answer(await perform<{ expected: number; difference: number }>('till_close', data)),
  );
