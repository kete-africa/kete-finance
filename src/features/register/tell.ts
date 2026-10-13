import { getCenter } from '@/platform/center';
import { transaction } from '@/platform/db';
import { log } from '@/platform/log';
import { markTold, untoldFacts } from './register.table';

/**
 * Tells the center what the register holds and it has not heard yet (doctrine D-049): each fact,
 * with the token of the person who just acted. A fact the center did not take — it is down, or
 * she may not record money there — waits in the register and travels with the next gesture of
 * someone who may. Never fails the gesture it follows.
 */
export async function tellCenter(
  token: string | null | undefined,
  organizationId: string,
): Promise<{ told: number; waiting: number }> {
  const center = getCenter();
  const facts = await transaction(organizationId, (db) => untoldFacts(db));
  if (!center.connected || !token) return { told: 0, waiting: facts.length };
  let told = 0;
  for (const fact of facts) {
    try {
      if (fact.gone) {
        await center.dropMoneyFact(token, fact.key);
      } else {
        const { ok, error } = await center.sendMoneyFact(token, {
          key: fact.key,
          kind: fact.kind,
          amount: fact.amount,
          currency: fact.currency,
          occurredOn: fact.occurredOn,
          label: fact.label,
          ...(fact.projectId ? { projectId: fact.projectId } : {}),
          ...(fact.post ? { post: fact.post } : {}),
          ...(fact.partyId ? { partyId: fact.partyId } : {}),
          ...(fact.href ? { href: fact.href } : {}),
        });
        if (!ok) {
          log.warn('fact not told to the center', { key: fact.key, error });
          // The center refuses her, or is away: the rest would be refused the same way.
          break;
        }
      }
      await transaction(organizationId, (db) => markTold(db, fact));
      told += 1;
    } catch (error) {
      log.warn('fact not told to the center', { key: fact.key, error });
      break;
    }
  }
  return { told, waiting: facts.length - told };
}
