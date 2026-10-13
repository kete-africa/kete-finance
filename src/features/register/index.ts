// The register of money: the only door of the feature.
export {
  countUntold,
  dropFact,
  listFacts,
  moveFacts,
  registerMigrationSql,
  sayFact,
  type Fact,
  type FactKind,
} from './register.table';
export { tellCenter } from './tell';
export { CURRENCY, hrefOf, today } from './setting';
