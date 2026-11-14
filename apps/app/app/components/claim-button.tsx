"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

// Claim stub -- there is no settle()'d challenge or claim instruction to
// call yet. Disabled until a wallet is connected so the real wiring point
// (send the claim tx, then POST its signature to record member_payouts) is
// obvious.
export function ClaimButton({ memberId }: { memberId: string }) {
  const { connected } = useWallet();
  const [claimed, setClaimed] = useState(false);

  return (
    <button
      type="button"
      data-member-id={memberId}
      disabled={!connected || claimed}
      onClick={() => setClaimed(true)}
      className="rounded-full border border-black/10 px-4 py-1.5 text-xs font-medium disabled:opacity-40 dark:border-white/15"
      title={connected ? undefined : "Connect a wallet to claim"}
    >
      {claimed ? "Claimed (demo)" : "Claim"}
    </button>
  );
}
