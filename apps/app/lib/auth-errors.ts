// Sign-up and password-reset must answer the same way whether or not an email is registered. GoTrue can still
// differ (e.g. 429 over_email_send_rate_limit only for a known address emailed recently), so every server answer
// shows the neutral "check your email" result, except:
// - weak_password on sign-up, which GoTrue checks before looking the address up;
// - a network failure (no HTTP status), where the server never answered and nothing about the address leaks.
export type AuthErrorLike = { code?: string; status?: number } | null | undefined;

export function isNeutralAuthError(error: AuthErrorLike, context: "signup" | "recover"): boolean {
  if (!error) return true;
  if (!error.status) return false;
  return context === "recover" || error.code !== "weak_password";
}
