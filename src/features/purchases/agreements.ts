import { log } from '@/platform/log';
import { currentToken } from '@/platform/person';

// What a project's funders allow it to spend (doctrine D-048): their agreements live in Kete
// Commitments, which answers whether an expense is allowed and cites the passage when it is not.
// Asked with the token of who asks, before a request is written. Without Kete Commitments there is
// nothing to check; when it cannot be asked, the request goes on and says it was not checked —
// the circuit that decides it still sees it.

export interface Spend {
  projectId: string;
  post: string | null;
  amount: number;
  label: string;
  on: string;
}

export type AgreementVerdict =
  | { state: 'none' }
  | { state: 'allowed' }
  | { state: 'unchecked' }
  | { state: 'refused'; agreement: string; clause: string; detail: string };

type Check = (spend: Spend) => Promise<AgreementVerdict>;

/** Kete Commitments' API, as `COMMITMENTS_API_URL` names it. */
async function askCommitments(spend: Spend): Promise<AgreementVerdict> {
  const base = (process.env.COMMITMENTS_API_URL ?? '').trim().replace(/\/$/, '');
  if (!base) return { state: 'none' };
  const token = currentToken();
  if (!token) return { state: 'unchecked' };
  const response = await fetch(`${base}/api/v1/capabilities/spending_check`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': crypto.randomUUID(),
    },
    body: JSON.stringify({ ...spend, ...(spend.post ? {} : { post: undefined }) }),
    signal: AbortSignal.timeout(4000),
  }).catch(() => null);
  const answer = (await response?.json().catch(() => null)) as {
    status?: string;
    output?: {
      allowed?: boolean;
      refusals?: { agreement: string; clause: string; detail: string }[];
    };
  } | null;
  if (!response?.ok || answer?.status !== 'done' || typeof answer.output?.allowed !== 'boolean') {
    log.warn('funders not asked', { status: response?.status ?? null });
    return { state: 'unchecked' };
  }
  const [first] = answer.output.refusals ?? [];
  if (answer.output.allowed || !first) return { state: 'allowed' };
  return { state: 'refused', agreement: first.agreement, clause: first.clause, detail: first.detail };
}

let check: Check = askCommitments;

/** Tests and other hosts: another way to ask. */
export function useAgreementCheck(next: Check | undefined): void {
  check = next ?? askCommitments;
}

export function checkAgreements(spend: Spend): Promise<AgreementVerdict> {
  return check(spend);
}
