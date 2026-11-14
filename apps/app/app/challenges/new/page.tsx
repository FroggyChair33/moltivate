"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { WalletButton } from "@/app/components/wallet-button";
import { useProgram } from "@/lib/use-program";
import { DEFAULT_GROUP_ID, challengePda, potPda, teamPda } from "@/lib/anchor";

// Real on-chain create: initializes the creator's persistent group pot the
// first time it's needed, then calls `initialize`, which atomically creates
// the Challenge and both Team accounts. Devnet only -- see AGENTS.md
// "Financial correctness".
export default function NewChallengePage() {
  const router = useRouter();
  const { publicKey } = useWallet();
  const program = useProgram();

  const [title, setTitle] = useState("Push-up Pact");
  const [stakeSol, setStakeSol] = useState("0.25");
  const [goalReps, setGoalReps] = useState("150");
  const [alphaPercent, setAlphaPercent] = useState("20");
  const [rakePercent, setRakePercent] = useState("3");
  const [durationDays, setDurationDays] = useState("7");
  const [teamAName, setTeamAName] = useState("Sunrise Squad");
  const [teamBName, setTeamBName] = useState("Night Owls");
  const [oracle, setOracle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!program || !publicKey) return;
    setSubmitting(true);
    setError(null);
    try {
      const oracleKey = new PublicKey(oracle || publicKey.toBase58());

      const pot = potPda(publicKey, DEFAULT_GROUP_ID);
      const potAccount = await program.provider.connection.getAccountInfo(pot);
      if (!potAccount) {
        await program.methods
          .initializeGroup(DEFAULT_GROUP_ID)
          .accounts({ creator: publicKey })
          .rpc();
      }

      const challengeId = new BN(Date.now());
      const challenge = challengePda(publicKey, challengeId);
      const deadlineUnix = new BN(Math.floor(Date.now() / 1000) + Number(durationDays) * 86400);

      await program.methods
        .initialize({
          id: challengeId,
          oracle: oracleKey,
          alphaBps: Math.round(Number(alphaPercent) * 100),
          rakeBps: Math.round(Number(rakePercent) * 100),
          target: Number(goalReps),
          stakeLamports: new BN(Math.round(Number(stakeSol) * 1_000_000_000)),
          deadlineUnix,
          teamAName,
          teamBName,
        })
        .accounts({
          teamA: teamPda(challenge, 0),
          teamB: teamPda(challenge, 1),
        })
        .rpc();

      router.push(`/join/${challenge.toBase58()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!publicKey) {
    return (
      <div className="mx-auto w-full max-w-lg px-6 py-12">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Create a challenge</h1>
        <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
          Connect your Phantom wallet (devnet) to create a challenge.
        </p>
        <WalletButton />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-lg px-6 py-12">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">
        Create a challenge
      </h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <Field label="Title">
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Push-up Pact"
            className="input"
          />
        </Field>

        <Field label="Stake per person (devnet SOL)">
          <input
            required
            type="number"
            min="0"
            step="0.01"
            value={stakeSol}
            onChange={(e) => setStakeSol(e.target.value)}
            className="input"
          />
        </Field>

        <Field label="Weekly goal (reps)">
          <input
            required
            type="number"
            min="1"
            value={goalReps}
            onChange={(e) => setGoalReps(e.target.value)}
            className="input"
          />
        </Field>

        <Field label="Alpha (% of stake always at risk)">
          <input
            required
            type="number"
            min="0"
            max="100"
            value={alphaPercent}
            onChange={(e) => setAlphaPercent(e.target.value)}
            className="input"
          />
        </Field>

        <Field label="House rake (%)">
          <input
            required
            type="number"
            min="0"
            max="100"
            value={rakePercent}
            onChange={(e) => setRakePercent(e.target.value)}
            className="input"
          />
        </Field>

        <Field label="Duration (days)">
          <input
            required
            type="number"
            min="1"
            value={durationDays}
            onChange={(e) => setDurationDays(e.target.value)}
            className="input"
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Team A name">
            <input
              required
              value={teamAName}
              onChange={(e) => setTeamAName(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Team B name">
            <input
              required
              value={teamBName}
              onChange={(e) => setTeamBName(e.target.value)}
              className="input"
            />
          </Field>
        </div>

        <Field label="Oracle address (leave blank to use your own wallet for now)">
          <input
            value={oracle}
            onChange={(e) => setOracle(e.target.value)}
            placeholder={publicKey.toBase58()}
            className="input"
          />
        </Field>

        {error && (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="mt-2 rounded-full bg-foreground px-6 py-3 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
        >
          {submitting ? "Creating on devnet..." : "Create"}
        </button>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}
