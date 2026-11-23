"use client";

import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletButton } from "@/app/components/wallet-button";
import { useAccount } from "@/app/components/account-provider";

// Wraps only the actions that need the connected wallet's signature (deposit,
// create, claim). Reads, workouts and Close go through the account instead.
export function LinkedWalletGate({ children }: { children: React.ReactNode }) {
  const { me, status } = useAccount();
  const { publicKey } = useWallet();
  if (status === "loading") return <p className="text-sm text-muted" role="status">Checking your account…</p>;
  if (status === "signedOut" || !me) return <p className="text-sm"><Link href="/login" className="underline">Log in</Link> to continue.</p>;
  if (!publicKey) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm">Connect the Phantom wallet linked to your account to sign this on devnet.</p>
        <WalletButton />
      </div>
    );
  }
  if (!me.wallets.includes(publicKey.toBase58())) {
    return (
      <div className="flex flex-col gap-3" role="alert">
        <p className="text-sm font-medium">This wallet isn&apos;t linked to your account</p>
        <p className="text-sm text-muted">Link it on the Account page, or switch to a wallet you&apos;ve already linked.</p>
        <Link href="/account" className="underline">Go to Account</Link>
      </div>
    );
  }
  return <>{children}</>;
}
