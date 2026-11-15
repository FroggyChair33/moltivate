"use client";

import { useEffect, useState } from "react";

// Batch display-name lookup for a set of wallet addresses, e.g. the owners
// shown on a scoreboard. Falls back to the truncated address wherever a
// wallet has never set one.
export function useDisplayNames(wallets: string[]): Record<string, string> {
  const [names, setNames] = useState<Record<string, string>>({});
  const key = [...new Set(wallets)].sort().join(",");

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/users?wallets=${encodeURIComponent(key)}`);
      const data = await res.json().catch(() => ({}));
      if (!cancelled) setNames(data.names ?? {});
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  return names;
}

export function displayNameOrShort(wallet: string, names: Record<string, string>): string {
  return names[wallet] ?? `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
}
