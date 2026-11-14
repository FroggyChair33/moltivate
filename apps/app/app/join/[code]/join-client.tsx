"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { mockChallenge } from "@/lib/mock-data";
import { WalletButton } from "@/app/components/wallet-button";

export function JoinClient({ code }: { code: string }) {
  const { connected, publicKey } = useWallet();
  const [teamId, setTeamId] = useState<string | null>(null);
  const [depositing, setDepositing] = useState(false);
  const [deposited, setDeposited] = useState(false);

  const challenge = mockChallenge;

  function handleDeposit() {
    // TODO: build and send the Anchor join/deposit instruction once
    // programs/commitment-stakes/ exposes it, then POST the resulting
    // signature to an API route that records team_members.deposit_tx_signature.
    setDepositing(true);
    setTimeout(() => {
      setDepositing(false);
      setDeposited(true);
    }, 600);
  }

  return (
    <div className="mx-auto w-full max-w-md px-6 py-12">
      <p className="mb-1 text-xs uppercase tracking-wide text-zinc-500">
        Invite code: {code}
      </p>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">
        {challenge.title}
      </h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        {challenge.goalReps} {challenge.exercise} by{" "}
        {new Date(challenge.endsAt).toLocaleDateString()} &middot; stake{" "}
        {challenge.stakeSol} SOL (devnet)
      </p>

      {!connected ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">Connect your Phantom wallet to join.</p>
          <WalletButton />
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Connected as {publicKey?.toBase58().slice(0, 4)}...
            {publicKey?.toBase58().slice(-4)}
          </p>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Pick a team</span>
            {challenge.teams.map((team) => (
              <button
                key={team.id}
                type="button"
                onClick={() => setTeamId(team.id)}
                className={`rounded-lg border px-4 py-2 text-left text-sm ${
                  teamId === team.id
                    ? "border-foreground"
                    : "border-black/10 dark:border-white/15"
                }`}
              >
                {team.name}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={!teamId || depositing || deposited}
            onClick={handleDeposit}
            className="rounded-full bg-foreground px-6 py-3 text-sm font-medium text-background transition-colors disabled:opacity-50"
          >
            {deposited
              ? "Deposited (demo)"
              : depositing
                ? "Depositing..."
                : `Deposit ${challenge.stakeSol} SOL`}
          </button>
          <p className="text-xs text-zinc-500">
            Demo only: no transaction is sent yet. Network: devnet.
          </p>
        </div>
      )}
    </div>
  );
}
