"use client";

import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { useProgram } from "@/lib/use-program";
import { vaultPda } from "@/lib/anchor";

export function ClaimButton({
  challenge,
  teamMember,
  owner,
  alreadyClaimed,
}: {
  challenge: string;
  teamMember: string;
  owner: string;
  alreadyClaimed: boolean;
}) {
  const { connected, publicKey } = useWallet();
  const isOwner = connected && publicKey?.toBase58() === owner;
  const program = useProgram();
  const [claimed, setClaimed] = useState(alreadyClaimed);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClaim() {
    if (!program || !publicKey) return;
    setClaiming(true);
    setError(null);
    try {
      // Anchor's generated ResolvedAccounts<...> type for `claim` rejects
      // an inline object literal with all four of these keys (a type
      // generation quirk from mixing a `relations` account with `pda`
      // accounts in the same instruction - excess-property checking only
      // applies to inline literals, so building the object as its own
      // const first sidesteps it without weakening any other type safety).
      const claimAccounts = {
        memberAuthority: publicKey,
        challenge: new PublicKey(challenge),
        vault: vaultPda(new PublicKey(challenge)),
        teamMember: new PublicKey(teamMember),
      };
      await program.methods.claim().accounts(claimAccounts).rpc();
      setClaimed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setClaiming(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={!isOwner || claimed || claiming}
        onClick={handleClaim}
        className="rounded-full border border-black/10 px-4 py-1.5 text-xs font-medium disabled:opacity-40 dark:border-white/15"
        title={isOwner ? undefined : "Only this member's own wallet can claim their payout"}
      >
        {claimed ? "Claimed" : claiming ? "Claiming..." : "Claim"}
      </button>
      {error && <p className="text-xs text-red-700 dark:text-red-300">{error}</p>}
    </div>
  );
}
