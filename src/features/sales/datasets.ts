import { defineDataset } from '@kete/capabilities';
import { z } from 'zod';
import { invoiceRows } from './infrastructure/sales.table';

/**
 * The issued invoices as a data set: for people's dashboards, the assistant and other apps, under
 * the read permission — one row per invoice, dated by its issue. Amounts are in the currency's
 * smallest unit.
 */
export const salesDatasets = [
  defineDataset({
    name: 'invoices',
    description:
      'One row per issued invoice: its number, the client, its day, its total, what was received, what is still due, and 1 when paid.',
    permission: 'sales:read',
    // Clients and amounts: the organization's people who read sales, not beyond.
    classification: 'confidential',
    row: z.object({
      number: z.string(),
      party: z.string(),
      issuedOn: z.string(),
      total: z.number(),
      received: z.number(),
      due: z.number(),
      paid: z.number(),
    }),
    time: 'issuedOn',
    measures: ['total', 'received', 'due', 'paid'],
    dimensions: ['party'],
    rows: (query, { db }) => invoiceRows(db, query),
  }),
];
