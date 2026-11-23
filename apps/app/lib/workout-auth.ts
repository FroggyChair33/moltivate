// Session keys for workout submissions, shared by the squat session (signs)
// and /api/workout-sessions (verifies).
//
// When a session starts, the browser makes a throwaway keypair and the wallet
// signs sessionAuthMessage once: "this key may submit workouts for this member
// until expiresAt". Each submission is then signed by the throwaway key over
// workoutMessage, so there's no wallet pop-up per set. The server checks both
// signatures, the expiry, and that the wallet owns the member account on chain.
//
// This proves who is submitting, not that the reps are real: the browser
// still counts them, so they stay 'unverified'.

export const SESSION_KEY_TTL_SECONDS = 2 * 60 * 60;

export type SessionAuth = {
  wallet: string;
  sessionKey: string;
  challenge: string;
  member: string;
  expiresAt: number; // unix seconds
};

export function sessionAuthMessage(auth: SessionAuth): string {
  return [
    `Moltivate: let this browser tab submit workouts for you until ${new Date(auth.expiresAt * 1000).toISOString()}.`,
    "",
    `Challenge: ${auth.challenge}`,
    `Member: ${auth.member}`,
    `Wallet: ${auth.wallet}`,
    `Session key: ${auth.sessionKey}`,
  ].join("\n");
}

// JSON keeps the fields unambiguous whatever the idempotency key contains.
export function workoutMessage(w: { challenge: string; member: string; idempotencyKey: string; reps: number }): string {
  return `moltivate-workout:${JSON.stringify([w.challenge, w.member, w.idempotencyKey, w.reps])}`;
}
