import { executeCommand, type Actor } from '@kete/commands';
import { formatMoney, money } from '@kete/money';
import * as m from '@/paraglide/messages.js';
import { getCenter } from '@/platform/center';
import { transaction } from '@/platform/db';
import { PRODUCT } from '@/platform/app';
import { log } from '@/platform/log';
import { passGesture, sentencesOf } from '@/platform/policies';
import { routeRequest, settleRequest } from './commands/requests';
import { plainSubject, subjectOf } from './domain/purchases';
import {
  findRequest,
  requestOfDecision,
  requestsToRoute,
} from './infrastructure/purchases.table';
import type { PurchaseRequest } from './purchase.record';

type Caller = { organizationId: string; actor: Actor };

/** The app itself, applying what the center decided. */
const APP: Actor = { kind: 'app', id: 'app_center', channel: 'api' };

/** What the deciders read at the center: the request, and that it goes beyond its post. */
function titleOf(request: PurchaseRequest): string {
  const beyond = request.standing?.beyondBy ?? 0;
  return beyond > 0
    ? m.center_request_beyond({
        number: request.number,
        title: request.title,
        by: formatMoney(money(beyond, request.currency)),
        post: request.post ?? '',
      })
    : m.center_request({ number: request.number, title: request.title });
}

/** A request as the organization's policies read it: a purchase committed, on its project. */
const gestureOf = (request: PurchaseRequest) => ({
  kind: 'purchase.commit',
  object: request.projectId
    ? { kind: 'project', id: request.projectId }
    : { kind: 'subject', id: `${PRODUCT}.${request.kind}` },
  amount: { value: request.amount, currency: request.currency },
  ...(request.standing ? { context: { budgetLeft: request.standing.left } } : {}),
});

/** Where the center tells the app a request was decided: an https address only. */
function callbackUrl(): string | undefined {
  const base = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
  return base.startsWith('https://') ? `${base}/api/centre/decisions` : undefined;
}

/**
 * After she asked: who decides her requests. The center's circuits when the organization has one
 * for the subject — **beyond its post, a request takes the circuit of what goes beyond the
 * budget**, the one that goes up; without such a circuit, the ordinary one. Without any circuit,
 * or without a center, this app's own rule: who may approve purchases, never who asked. A center
 * that does not answer leaves the request waiting for her next gesture.
 */
export async function routeWaiting(
  token: string | null | undefined,
  caller: Caller,
): Promise<number> {
  const center = getCenter();
  const requesterId = caller.actor.onBehalfOf?.id ?? caller.actor.id;
  const requests = await transaction(caller.organizationId, (db) =>
    requestsToRoute(db, requesterId),
  );
  let routed = 0;
  for (const request of requests) {
    const decided = async (
      route: 'center' | 'here',
      decisionRequestId?: string,
      decisionSubject?: string,
      approverId?: string,
    ) => {
      await transaction(caller.organizationId, (db) =>
        executeCommand(db, routeRequest, {
          ...caller,
          idempotencyKey: `route-${crypto.randomUUID()}`,
          input: {
            requestId: request.requestId,
            route,
            ...(decisionRequestId && decisionSubject ? { decisionRequestId, decisionSubject } : {}),
            ...(approverId ? { approverId } : {}),
          },
        }),
      );
      routed += 1;
    };
    if (!center.connected) {
      await decided('here');
      continue;
    }
    // The organization's policies first (kete-core spec 114): what they allow as it stands is
    // approved at once, what they refuse is refused with their sentences; what they leave unruled,
    // or ask an approval for, goes to who decides — the one they name, when decided here.
    const verdict = await passGesture(token, caller.actor, gestureOf(request));
    if (verdict.effect === 'allow' || verdict.effect === 'refuse') {
      await decided('center');
      await applyDecision(caller.organizationId, request.requestId, {
        status: verdict.effect === 'allow' ? 'approved' : 'refused',
        decidedBy: m.decided_by_policy(),
        reason: sentencesOf(verdict) || null,
      });
      continue;
    }
    const approverId =
      verdict.effect === 'approve' ? verdict.approvers.flatMap((a) => a.people)[0] : undefined;
    const ask = (subject: string) =>
      center.requestDecision(token, {
        subject,
        reference: request.requestId,
        title: titleOf(request),
        measure: request.amount,
        ...(request.projectId ? { projectId: request.projectId } : {}),
        ...(callbackUrl() ? { callbackUrl: callbackUrl() as string } : {}),
      });
    // Sent back and corrected, it is asked under the subject it was first asked under: the
    // center's same request, whatever the correction changed.
    let subject: string =
      request.decisionSubject ?? subjectOf(request.kind, request.standing?.beyondBy ?? 0);
    let answer = await ask(subject);
    if (!answer.ok && answer.error === 'no_circuit' && subject === 'beyond_budget') {
      subject = plainSubject(request.kind);
      answer = await ask(subject);
    }
    if (answer.ok) {
      await decided('center', answer.requestId, subject);
      // A circuit that only informs decides at once.
      if (answer.status === 'approved' || answer.status === 'refused') {
        await applyDecision(caller.organizationId, request.requestId, {
          status: answer.status,
          decidedBy: null,
          reason: null,
        });
      }
    } else if (answer.error === 'no_circuit' || answer.error === 'unknown_subject') {
      await decided('here', undefined, undefined, approverId);
    } else {
      log.warn('decision not asked at the center', { request: request.number, error: answer.error });
      break;
    }
  }
  return routed;
}

/** Applies a decision of the center to its request here; applied twice, it changes nothing. */
export async function applyDecision(
  organizationId: string,
  requestId: string,
  decision: { status: string; decidedBy: string | null; reason: string | null },
): Promise<boolean> {
  const to = { approved: 'approve', refused: 'refuse', returned: 'return' }[decision.status] as
    | 'approve'
    | 'refuse'
    | 'return'
    | undefined;
  if (!to) return false;
  return transaction(organizationId, async (db) => {
    const request = await findRequest(db, requestId);
    if (!request || request.status !== 'asked' || request.route !== 'center') return false;
    await executeCommand(db, settleRequest, {
      organizationId,
      actor: APP,
      idempotencyKey: `settle-${crypto.randomUUID()}`,
      input: {
        requestId,
        decision: to,
        by: decision.decidedBy ?? m.decided_by_circuit(),
        ...(decision.reason ? { reason: decision.reason } : to === 'return' ? { reason: '—' } : {}),
      },
    });
    return true;
  });
}

/**
 * Reads at the center where a request stands, with the app's own token, and applies it. Called
 * when the center says a request was decided, and when someone opens a request that still waits.
 */
export async function readDecision(
  appToken: string | null,
  organizationId: string,
  requestId: string,
): Promise<boolean> {
  const request = await transaction(organizationId, (db) => findRequest(db, requestId));
  if (!request?.decisionRequestId || request.status !== 'asked') return false;
  const decision = await getCenter().decision(appToken, organizationId, request.decisionRequestId);
  if (!decision || decision.status === 'pending') return false;
  return applyDecision(organizationId, requestId, decision);
}

/** The center says one of its requests was decided: the app reads it, and applies it. */
export async function decisionOf(
  appToken: string | null,
  organizationId: string,
  decisionRequestId: string,
): Promise<boolean> {
  const requestId = await transaction(organizationId, (db) =>
    requestOfDecision(db, decisionRequestId),
  );
  return requestId ? readDecision(appToken, organizationId, requestId) : false;
}
