"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

// The GET /api/me body.
export type Me = { email: string; displayName: string | null; needsDisplayName: boolean; wallets: string[] };
type AccountState = { status: "loading" | "signedOut" | "signedIn"; me: Me | null; refresh(): Promise<void> };

const AccountContext = createContext<AccountState>({ status: "loading", me: null, refresh: async () => {} });

export function useAccount(): AccountState {
  return useContext(AccountContext);
}

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AccountState["status"]>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/me", { cache: "no-store" });
      if (res.ok) {
        setMe(await res.json());
        setStatus("signedIn");
        return;
      }
      // 401 (or 403: unverified email / two-step pending) means no usable session. A 5xx keeps the last known state.
      if (res.status === 401 || res.status === 403) {
        setMe(null);
        setStatus("signedOut");
      }
    } catch {
      // Network failure: keep the last known state.
    }
  }, []);

  // Pages call refresh() (or dispatch "moltivate:updated") after login, logout or a name change.
  useEffect(() => {
    const onUpdated = () => void refresh();
    onUpdated();
    window.addEventListener("moltivate:updated", onUpdated);
    return () => window.removeEventListener("moltivate:updated", onUpdated);
  }, [refresh]);

  useEffect(() => {
    if (me?.needsDisplayName && pathname !== "/welcome") router.replace("/welcome");
  }, [me, pathname, router]);

  return <AccountContext.Provider value={{ status, me, refresh }}>{children}</AccountContext.Provider>;
}
