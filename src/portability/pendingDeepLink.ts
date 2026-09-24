/** Module-level pending deep-link payload — transport only, never auto-imports. */
let pending: string | null = null;

export function setPendingDeepLink(encoded: string): void {
  pending = encoded;
}

export function takePendingDeepLink(): string | null {
  const p = pending;
  pending = null;
  return p;
}

export function peekPendingDeepLink(): string | null {
  return pending;
}
