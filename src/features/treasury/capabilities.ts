import { defineCapability } from '@kete/capabilities';
import { money, toDecimal } from '@kete/money';
import { z } from 'zod';
import { CURRENCY } from '@/features/register';
import {
  assignMovement,
  closeTill,
  openAccount,
  recordMovement,
  transferMoney,
} from './commands/treasury';
import { treasuryStanding } from './standing';
import {
  accountInput,
  assignInput,
  closingInput,
  movementInput,
  transferInput,
} from './treasury.record';

const shown = (amount: number) => `${toDecimal(money(amount, CURRENCY))} ${CURRENCY}`;

/**
 * What agents may do with the treasury: read where the money stands — every figure computed here,
 * never by a model. Opening an account, moving money and closing a till are a person's.
 */
export const treasuryCapabilities = [
  defineCapability({
    name: 'treasury_standing',
    description:
      'Where the money stands: what is held in the bank, the tills and the wallets; what of it is reserved for projects; what is committed beyond that; what is really available; and each project’s funds — received, spent, available, committed, overdrawn.',
    permission: 'treasury:read',
    autonomy: 1,
    classification: 'confidential',
    input: z.object({}),
    async run(_input, { db }) {
      const standing = await treasuryStanding(db);
      return {
        held: shown(standing.held),
        reservedForProjects: shown(standing.reserved),
        committed: shown(standing.committed),
        reallyAvailable: shown(standing.available),
        accounts: standing.accounts
          .filter((account) => account.active)
          .map((account) => ({
            name: account.name,
            kind: account.kind,
            balance: shown(account.balance),
          })),
        projects: standing.projects.map((project) => ({
          projectId: project.projectId,
          received: shown(project.received),
          spent: shown(project.spent),
          available: shown(project.available),
          committed: shown(project.committed),
          overdrawn: shown(project.overdrawn),
        })),
        movementsWaitingForAnAccount: standing.unassigned,
      };
    },
  }),
  defineCapability({
    name: 'treasury_open_account',
    description: 'Opens a bank account, a till or a mobile wallet, with what it holds that day.',
    permission: 'treasury:manage',
    autonomy: 3,
    input: accountInput,
    command: openAccount,
    draft: { recordType: 'account' },
  }),
  defineCapability({
    name: 'treasury_move',
    description:
      'Records money that came in or went out outside sales and purchases: bank fees, a contribution.',
    permission: 'treasury:manage',
    autonomy: 4,
    input: movementInput,
    command: recordMovement,
    draft: { recordType: 'account_movement' },
  }),
  defineCapability({
    name: 'treasury_transfer',
    description: 'Carries money from one account to another: the till’s cash taken to the bank.',
    permission: 'treasury:manage',
    autonomy: 4,
    input: transferInput,
    command: transferMoney,
    draft: { recordType: 'account_transfer' },
  }),
  defineCapability({
    name: 'treasury_assign',
    description: 'Gives its account to a movement that waited for one.',
    permission: 'treasury:manage',
    autonomy: 3,
    input: assignInput,
    command: assignMovement,
    draft: { recordType: 'movement_assignment' },
  }),
  defineCapability({
    name: 'till_close',
    description:
      'Closes a till for a day: what was counted in the drawer against what the movements say.',
    permission: 'treasury:close',
    autonomy: 4,
    input: closingInput,
    command: closeTill,
    draft: { recordType: 'till_closing' },
  }),
];
