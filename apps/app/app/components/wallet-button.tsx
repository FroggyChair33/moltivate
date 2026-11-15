"use client";

import { useEffect, useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

// Injected Phantom can connect directly. Other mobile browsers get explicit
// recovery guidance until the physical-device deep-link flow is verified.
function isMobileBrowser(): boolean {
  return /iPhone|iPod|Android.*Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

// WalletMultiButton reads wallet-adapter state (connected wallet, selected
// adapter) that only exists in the browser. Next.js still server-renders
// "use client" components for the initial HTML, so its SSR markup ("Select
// Wallet") can disagree with the client's first paint once wallet-adapter's
// own browser-only state resolves -- a hydration mismatch (React error
// #418) that can leave the button unresponsive. Gating the real button
// behind a post-mount check means it never participates in SSR at all.
export function WalletButton() {
  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    // The standard SSR-hydration-mismatch workaround: this must flip to
    // true only after hydration has already matched the server's output,
    // which is exactly what an effect (as opposed to a lazy initializer)
    // guarantees. navigator.userAgent is equally browser-only, so it's read
    // here too rather than during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    const injected = (window as Window & { phantom?: { solana?: { isPhantom?: boolean } }; solana?: { isPhantom?: boolean } });
    setIsMobile(isMobileBrowser() && !injected.phantom?.solana?.isPhantom && !injected.solana?.isPhantom);
  }, []);

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

  if (isMobile) {
    return (
      <details className="max-w-xs rounded-xl border border-line px-3 text-sm">
        <summary className="flex cursor-pointer items-center">Connect on mobile</summary>
        <p className="pb-3 text-muted">Open this site in Phantom’s browser to try connecting. If it opens blank, return to Safari to browse, or connect from a desktop browser. iPhone wallet support is still being tested.</p>
      </details>
    );
  }

  return <WalletMultiButton className="!h-9 !rounded-full !text-sm" />;
}
