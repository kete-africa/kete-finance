import type { SqlExecutor } from '@kete/tenancy';
import { settingsIn } from '@/platform/settings';

/**
 * The currency of new documents (ISO 4217; kete-core specs 115 and 117): `kete.currency` as Kete
 * Finance sets it for the organization, else as the organization set it in the Compte Kete, else
 * F CFA. A document keeps the currency it was written in.
 */
export async function currencyIn(db: SqlExecutor, organizationId: string): Promise<string> {
  return (await settingsIn(db, organizationId)).value<string>('kete.currency');
}

/** Today, as documents date themselves (`2026-10-13`). */
export function today(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Where a document of this app opens, for who reads its fact at the center. */
export function hrefOf(path: string): string | null {
  const base = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
  return base ? `${base}${path}` : null;
}

/** A holding's address at the center (kete-core spec 114): an https page of this app, or none. */
export function linkOf(path: string): { href?: string } {
  const href = hrefOf(path);
  return href?.startsWith('https://') ? { href } : {};
}
