// Shared by the results page (signs it) and /api/challenges/close (verifies it).
// Binding both the wallet and the challenge means a captured signature can only
// re-close that one challenge for that one wallet -- a harmless no-op, since
// closing is idempotent -- so it needs no expiry or nonce.
export function closeChallengeMessage(wallet: string, challenge: string): string {
  return `Moltivate: close challenge ${challenge} for ${wallet}`;
}
