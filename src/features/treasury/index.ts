// The treasury feature's only door: what the rest of the app may use.
export { treasuryCapabilities } from './capabilities';
export { treasuryPermissions } from './policies';
export { moveMoney, treasuryMigrationSql } from './infrastructure/treasury.table';
export { treasuryStanding } from './standing';
export type { Account, Closing, Movement } from './treasury.record';
