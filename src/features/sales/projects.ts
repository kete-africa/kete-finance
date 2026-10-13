import { executeCommand, type Actor } from '@kete/commands';
import { getCenter } from '@/platform/center';
import { transaction } from '@/platform/db';
import { log } from '@/platform/log';
import { attachProject } from './commands/quotes';
import { budgetOf } from './domain/totals';
import { quotesWithoutProject } from './infrastructure/sales.table';

/**
 * A won quote becomes a project at the center, with its budget (doctrine D-047): its name, its
 * client, what was sold, and one post per budget post of its lines, at their cost. Asked with the
 * token of who just acted; asked twice, the center answers the same project. A quote the center
 * did not open — it is away, or she may not open projects there — waits, and is opened with the
 * next gesture of someone who may.
 */
export async function openWonProjects(
  token: string | null | undefined,
  caller: { organizationId: string; actor: Actor },
): Promise<number> {
  const center = getCenter();
  if (!center.connected || !token) return 0;
  const quotes = await transaction(caller.organizationId, (db) => quotesWithoutProject(db));
  let opened = 0;
  for (const quote of quotes) {
    const answer = await center.openProject(token, {
      name: quote.title,
      reference: quote.number,
      ...(quote.partyId ? { partyId: quote.partyId } : {}),
      sold: quote.total,
      currency: quote.currency,
      posts: budgetOf(quote.lines, quote.currency),
    });
    if (!answer.ok) {
      log.warn('project not opened at the center', { quote: quote.number, error: answer.error });
      // Refused or away: the next quote would get the same answer.
      break;
    }
    await transaction(caller.organizationId, (db) =>
      executeCommand(db, attachProject, {
        ...caller,
        idempotencyKey: `attach-${quote.quoteId}-${answer.project.projectId}`,
        input: {
          quoteId: quote.quoteId,
          projectId: answer.project.projectId,
          projectName: answer.project.name,
        },
      }),
    );
    opened += 1;
  }
  return opened;
}
