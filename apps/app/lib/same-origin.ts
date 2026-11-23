// CSRF guard for cookie-authenticated POSTs: the Origin header must match the request's own origin.
export function isSameOrigin(originHeader: string | null, requestUrl: string): boolean {
  if (!originHeader) return false;
  try {
    return originHeader === new URL(requestUrl).origin;
  } catch {
    return false;
  }
}
