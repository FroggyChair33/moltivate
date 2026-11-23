"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { loadMe } from "@/lib/account-load";

// The GET /api/me body.
export type Me = { email: string; displayName: string | null; needsDisplayName: boolean; wallets: string[] };
type AccountState = { status: "loading" | "signedOut" | "signedIn" | "error"; me: Me | null; refresh(): Promise<void> };

const AccountContext = createContext<AccountState>({ status: "loading", me: null, refresh: async () => {} });

export function useAccount(): AccountState {
  return useContext(AccountContext);
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AccountState["status"]>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const statusRef = useRef(status);
  const latestRequest = useRef(0);
  const router = useRouter();
  const pathname = usePathname();

  const refresh = useCallback(async () => {
    const request = ++latestRequest.current;
    const outcome = await loadMe<Me>(() => fetch("/api/me", { cache: "no-store" }), wait);
    if (request !== latestRequest.current) return; // a newer refresh owns the state
    if (outcome.kind === "signedIn") setMe(outcome.me);
    // On a 5xx/network error keep `me` only if it came from an earlier good load.
    else if (outcome.kind === "signedOut" || statusRef.current !== "signedIn") setMe(null);
    statusRef.current = outcome.kind;
    setStatus(outcome.kind);
  }, []);

  // Pages call refresh() (or dispatch "moltivate:updated") after login, logout or a name change.
  useEffect(() => {
    const onUpdated = () => void refresh();
    onUpdated();
    window.addEventListener("moltivate:updated", onUpdated);
    window.addEventListener("focus", onUpdated);
    return () => {
      window.removeEventListener("moltivate:updated", onUpdated);
      window.removeEventListener("focus", onUpdated);
    };
  }, [refresh]);

  useEffect(() => {
    if (me?.needsDisplayName && pathname !== "/welcome") router.replace("/welcome");
  }, [me, pathname, router]);

  return <AccountContext.Provider value={{ status, me, refresh }}>{children}</AccountContext.Provider>;
}

// Shown wherever the account is needed but /api/me kept failing.
export function AccountLoadError() {
  const { refresh } = useAccount();
  const [busy, setBusy] = useState(false);
  async function retry() {
    setBusy(true);
    try {
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <p className="text-sm" role="alert">
      We couldn&apos;t load your account.{" "}
      <button type="button" className="underline" disabled={busy} onClick={() => void retry()}>{busy ? "Retrying…" : "Retry"}</button>
    </p>
  );
}
