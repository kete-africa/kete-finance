/**
 * The currency of the deployment's documents (`FINANCE_CURRENCY`, ISO 4217): F CFA by default. A
 * document keeps the currency it was written in.
 */
export const CURRENCY: string = (process.env.FINANCE_CURRENCY ?? 'XOF').toUpperCase();

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
