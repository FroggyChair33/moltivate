// Loads GET /api/me for AccountProvider. 401/403 mean no usable session (403:
// unverified email or two-step pending). A 5xx, other status or network
// failure is retried with a short backoff, then reported as "error".
export type MeOutcome<T> = { kind: "signedIn"; me: T } | { kind: "signedOut" } | { kind: "error" };

type MeResponse = { ok: boolean; status: number; json(): Promise<unknown> };

export async function loadMe<T>(
  fetchMe: () => Promise<MeResponse>,
  wait: (ms: number) => Promise<void>,
  attempts = 3,
): Promise<MeOutcome<T>> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await wait(500 * 2 ** (attempt - 1));
    try {
      const res = await fetchMe();
      if (res.ok) return { kind: "signedIn", me: (await res.json()) as T };
      if (res.status === 401 || res.status === 403) return { kind: "signedOut" };
    } catch {
      // Network failure (or an unreadable body): retry.
    }
  }
  return { kind: "error" };
}
