import { definePermissions } from '@kete/capabilities';
import * as m from '@/paraglide/messages.js';
import { words } from '@/platform/words';

/**
 * Who may do what with purchases and expenses. Who asks is not who approves, who approves is not
 * who orders, and who pays is never who asked (doctrine D-049). Anyone with a role of the trade
 * asks and reads her own requests; reading everyone's, approving here, ordering and paying are
 * each a permission.
 */
export const purchasesPermissions = definePermissions([
  {
    name: 'purchases:ask',
    label: words(m.perm_purchases_ask),
    description: words(m.perm_purchases_ask_body),
    roles: ['owner', 'admin'],
    businessRoles: ['sales', 'buyer', 'accountant', 'cashier'],
  },
  {
    name: 'purchases:read',
    label: words(m.perm_purchases_read),
    description: words(m.perm_purchases_read_body),
    roles: ['owner', 'admin'],
    businessRoles: ['buyer', 'accountant', 'cashier'],
  },
  {
    name: 'purchases:approve',
    label: words(m.perm_purchases_approve),
    description: words(m.perm_purchases_approve_body),
    roles: ['owner', 'admin'],
  },
  {
    name: 'purchases:order',
    label: words(m.perm_purchases_order),
    description: words(m.perm_purchases_order_body),
    roles: ['owner', 'admin'],
    businessRoles: ['buyer'],
  },
  {
    name: 'purchases:pay',
    label: words(m.perm_purchases_pay),
    description: words(m.perm_purchases_pay_body),
    roles: ['owner', 'admin'],
    businessRoles: ['cashier', 'accountant'],
  },
]);

/**
 * What the app asks the center's circuits to decide (manifest `subjects`): a purchase, an expense
 * note, and whatever goes beyond the post of its project's budget — the organization gives each
 * its circuit, and the last one goes higher.
 */
export const purchasesSubjects = [
  { name: 'purchase', label: words(m.subject_purchase) },
  { name: 'expense', label: words(m.subject_expense) },
  { name: 'beyond_budget', label: words(m.subject_beyond_budget) },
];
