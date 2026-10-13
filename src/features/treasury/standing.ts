import type { SqlExecutor } from '@kete/tenancy';
import { moneyByProject } from '@/features/register';
import { reallyAvailable, type MoneyStanding } from './domain/standing';
import { heldNow, listAccounts } from './infrastructure/treasury.table';
import type { Account } from './treasury.record';

export interface TreasuryStanding extends MoneyStanding {
  accounts: Account[];
  /** Movements no account takes yet: they are in nobody's balance. */
  unassigned: number;
  /** What the running of the organization received and spent, outside any project. */
  running: { received: number; spent: number; committed: number };
}

/**
 * Where the money stands (doctrine D-049): what is held — bank, tills, wallets — what of it is
 * reserved for projects, what is committed beyond that, and what is really available. Held comes
 * from the accounts; the rest from the register, project by project.
 */
export async function treasuryStanding(db: SqlExecutor): Promise<TreasuryStanding> {
  const { held, unassigned } = await heldNow(db);
  const money = await moneyByProject(db);
  return {
    ...reallyAvailable(held, money.projects, money.running.committed),
    accounts: await listAccounts(db),
    unassigned,
    running: money.running,
  };
}
