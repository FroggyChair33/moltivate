"use client";

import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

// Thin wrapper so the rest of the app doesn't import the wallet-adapter-ui
// button directly, and so brand styling can be layered on in one place.
export function WalletButton() {
  return <WalletMultiButton className="!h-9 !rounded-full !text-sm" />;
}
