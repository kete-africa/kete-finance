import { definePermissions } from '@kete/capabilities';
import * as m from '@/paraglide/messages.js';
import { words } from '@/platform/words';

/**
 * Who may do what with sales. Who writes a quote is not who issues the invoice, and who issues it
 * is not who takes the money in (doctrine D-049): three permissions, three roles of the trade by
 * default. Checked on the server for every surface; once the organization manages the app's rights
 * in Kete Enterprise, its grants decide.
 */
export const salesPermissions = definePermissions([
  {
    name: 'sales:read',
    label: words(m.perm_sales_read),
    description: words(m.perm_sales_read_body),
    roles: ['owner', 'admin'],
    businessRoles: ['sales', 'accountant', 'cashier'],
  },
  {
    name: 'sales:write',
    label: words(m.perm_sales_write),
    description: words(m.perm_sales_write_body),
    roles: ['owner', 'admin'],
    businessRoles: ['sales'],
  },
  {
    name: 'sales:issue',
    label: words(m.perm_sales_issue),
    description: words(m.perm_sales_issue_body),
    roles: ['owner', 'admin'],
    businessRoles: ['accountant'],
  },
  {
    name: 'sales:collect',
    label: words(m.perm_sales_collect),
    description: words(m.perm_sales_collect_body),
    roles: ['owner', 'admin'],
    businessRoles: ['cashier', 'accountant'],
  },
]);
