import { createCapabilityRegistry, createDatasetRegistry } from '@kete/capabilities';
import { purchasesCapabilities, useReadsAll } from '@/features/purchases';
import { salesCapabilities, salesDatasets } from '@/features/sales';
import { treasuryCapabilities } from '@/features/treasury';
import { transaction } from './db';
import { holds } from './rights';

/**
 * Every gesture of the app, the same for its screens, its MCP endpoint and its agents: same
 * rights, same journal, same autonomy rules (@kete/capabilities).
 */
export const registry = createCapabilityRegistry(
  [...salesCapabilities, ...purchasesCapabilities, ...treasuryCapabilities],
  {
    authorize: async (_caller, permission) => holds(permission),
    transaction,
  },
);

// Who reads every request, and who only her own: the feature asks, the rights answer.
useReadsAll(() => holds('purchases:read'));

/**
 * What the app exposes to dashboards, the assistant and other apps (kete-core spec 045): data sets
 * read with the same rights and organization as its capabilities.
 */
export const datasets = createDatasetRegistry([...salesDatasets], {
  authorize: async (_caller, permission) => holds(permission),
  transaction,
});
