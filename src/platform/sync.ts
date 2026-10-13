import type { Actor } from '@kete/commands';
import { tellCenter } from '@/features/register';
import { openWonProjects } from '@/features/sales';
import { log } from './log';

/**
 * After a gesture, what the center has not heard yet: the projects of won quotes first, then the
 * facts of money — so a fact travels with its project. With the token of who just acted, within
 * her rights at the center; what the center does not take waits for the next gesture. Never fails
 * the gesture it follows.
 */
export async function syncCenter(
  token: string | null | undefined,
  caller: { organizationId: string; actor: Actor },
): Promise<{ opened: number; told: number; waiting: number }> {
  try {
    const opened = await openWonProjects(token, caller);
    return { opened, ...(await tellCenter(token, caller.organizationId)) };
  } catch (error) {
    log.warn('the center was not told', { error });
    return { opened: 0, told: 0, waiting: 0 };
  }
}
