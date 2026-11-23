"use client";

import { useEffect, useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";

function ConnectLabel() {
  return <>Connect wallet</>;
}

// Injected Phantom can connect directly. Other mobile browsers get explicit
// recovery guidance until the physical-device deep-link flow is verified.
function isMobileBrowser(): boolean {
  return /iPhone|iPod|Android.*Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

// A phone browser without an injected Phantom: wallet connect is not expected to work there.
export function isPhoneWithoutWallet(): boolean {
  const injected = window as Window & { phantom?: { solana?: { isPhantom?: boolean } }; solana?: { isPhantom?: boolean } };
  return isMobileBrowser() && !injected.phantom?.solana?.isPhantom && !injected.solana?.isPhantom;
}

// WalletMultiButton reads wallet-adapter state (connected wallet, selected
// adapter) that only exists in the browser. Next.js still server-renders
// "use client" components for the initial HTML, so its SSR markup ("Select
// Wallet") can disagree with the client's first paint once wallet-adapter's
// own browser-only state resolves -- a hydration mismatch (React error
// #418) that can leave the button unresponsive. Gating the real button
// behind a post-mount check means it never participates in SSR at all.
export function WalletButton() {
  const { connected, connecting } = useWallet();
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
    setIsMobile(isPhoneWithoutWallet());
  }, []);

  if (!mounted) {
    return (
      <button
        type="button"
        disabled
        className="solana-button"
      >
        <ConnectLabel />
      </button>
    );
  }

  if (isMobile) {
    return (
      <details className="mobile-wallet">
        <summary className="solana-button" aria-label="Connect Solana wallet on mobile"><ConnectLabel /></summary>
        <p>Open this site in Phantom’s browser to try connecting. If it opens blank, return to Safari to browse, or connect from a desktop browser. iPhone wallet support is still being tested.</p>
      </details>
    );
  }

  return <WalletMultiButton className="solana-button">{!connected && !connecting ? <ConnectLabel /> : undefined}</WalletMultiButton>;
}
