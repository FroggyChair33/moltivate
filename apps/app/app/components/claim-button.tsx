"use client";

import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { useProgram } from "@/lib/use-program";
import { vaultPda } from "@/lib/anchor";
import { explorerTxUrl } from "@/lib/explorer";

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
  const [signature, setSignature] = useState<string | null>(null);

  async function handleClaim() {
    if (!program || !publicKey) return;
    setClaiming(true);
    setError(null);
    try {
      // .accountsPartial(), not .accounts(): the generated type for `claim`
      // mixes a `relations` account with `pda` accounts on the same
      // instruction, which the strict variant rejects for every valid key
      // combination (confirmed empirically). accountsPartial skips that
      // check so these can be supplied by hand.
      const sig = await program.methods
        .claim()
        .accountsPartial({
          memberAuthority: publicKey,
          challenge: new PublicKey(challenge),
          vault: vaultPda(new PublicKey(challenge)),
          teamMember: new PublicKey(teamMember),
        })
        .rpc();
      setSignature(sig);
      setClaimed(true);
      window.dispatchEvent(new Event("moltivate:updated"));
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
        disabled={!isOwner || claimed || alreadyClaimed || claiming}
        onClick={handleClaim}
        className="rounded-full border border-line px-4 py-1.5 text-xs font-medium disabled:opacity-40"
        title={isOwner ? undefined : "Only this member's own wallet can claim their payout"}
      >
        {claimed || alreadyClaimed ? "Claimed" : claiming ? "Awaiting wallet / confirmation…" : "Claim"}
      </button>
      {error && <p className="text-xs text-red-300">{error}</p>}
      {signature && (
        <a
          href={explorerTxUrl(signature)}
          target="_blank"
          rel="noreferrer"
          className="text-xs underline text-muted"
        >
          View on Solana Explorer
        </a>
      )}
    </div>
  );
}
