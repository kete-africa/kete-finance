import { definePermissions } from '@kete/capabilities';
import * as m from '@/paraglide/messages.js';
import { words } from '@/platform/words';

/**
 * Who may do what with the treasury. Who holds the till counts and closes it; who keeps the
 * accounts opens the accounts, carries money between them and records what moved outside sales
 * and purchases — and reads the closings (doctrine D-049).
 */
export const treasuryPermissions = definePermissions([
  {
    name: 'treasury:read',
    label: words(m.perm_treasury_read),
    description: words(m.perm_treasury_read_body),
    roles: ['owner', 'admin'],
    businessRoles: ['accountant', 'cashier'],
  },
  {
    name: 'treasury:manage',
    label: words(m.perm_treasury_manage),
    description: words(m.perm_treasury_manage_body),
    roles: ['owner', 'admin'],
    businessRoles: ['accountant'],
  },
  {
    name: 'treasury:close',
    label: words(m.perm_treasury_close),
    description: words(m.perm_treasury_close_body),
    roles: ['owner', 'admin'],
    businessRoles: ['cashier'],
  },
]);
