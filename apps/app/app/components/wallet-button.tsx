"use client";

import { useEffect, useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

// WalletMultiButton reads wallet-adapter state (connected wallet, selected
// adapter) that only exists in the browser. Next.js still server-renders
// "use client" components for the initial HTML, so its SSR markup ("Select
// Wallet") can disagree with the client's first paint once wallet-adapter's
// own browser-only state resolves -- a hydration mismatch (React error
// #418) that can leave the button unresponsive. Gating the real button
// behind a post-mount check means it never participates in SSR at all.
export function WalletButton() {
  const [mounted, setMounted] = useState(false);
  // The standard SSR-hydration-mismatch workaround: this must flip to true
  // only after hydration has already matched the server's output, which is
  // exactly what an effect (as opposed to a lazy initializer) guarantees.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <button
        type="button"
        disabled
        className="!h-9 rounded-full border border-black/10 px-4 text-sm opacity-50 dark:border-white/15"
      >
        Select Wallet
      </button>
    );
  }

  return <WalletMultiButton className="!h-9 !rounded-full !text-sm" />;
}
