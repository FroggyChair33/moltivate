"use client";

import { Suspense, useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { LinkedWalletGate } from "@/app/components/linked-wallet-gate";
import { useProgram } from "@/lib/use-program";
import { DEFAULT_GROUP_ID, challengePda, potPda, teamPda } from "@/lib/anchor";
import { describeTxError, sendWithPhases, type TxPhase } from "@/lib/send-tx";

// Real on-chain create: initializes the creator's persistent group pot the
// first time it's needed, then calls `initialize`, which atomically creates
// the Challenge and both Team accounts. Devnet only -- see AGENTS.md
// "Financial correctness".
//
// Alpha and rake are house-set constants, not something a challenge
// creator chooses -- matches the MVP doc's own default/worked example
// (alpha 20%, rake 3%) exactly. Versioned here (not just "the current
// default") because a future change to either must never reinterpret an
// already-created challenge: each Challenge account stores the bps values
// it was created with, so old challenges keep whatever was true when they
// were made regardless of what these constants become later.
const HOUSE_ALPHA_PERCENT = 20;
const HOUSE_RAKE_PERCENT = 3;
//
// useSearchParams() needs a Suspense boundary under the App Router (it
// opts the page out of static rendering) -- this is also what lets the
// results page's "Rematch" button prefill this form via query params
// instead of needing its own duplicate create flow.
export default function NewChallengePage() {
  return (
    <Suspense>
      <NewChallengeForm />
    </Suspense>
  );
}

function NewChallengeForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const program = useProgram();

  const [title, setTitle] = useState(params.get("title") ?? "Push-up Pact");
  const [stakeSol, setStakeSol] = useState(params.get("stakeSol") ?? "0.25");
  const [goalReps, setGoalReps] = useState(params.get("goalReps") ?? "150");
  // 7 days is the real default; a short fraction is supported too (see the
  // MVP doc's own "a few minutes" demo guidance) -- min/step below allow it.
  const [durationDays, setDurationDays] = useState("7");
  const [teamAName, setTeamAName] = useState(params.get("teamAName") ?? "Sunrise Squad");
  const [teamBName, setTeamBName] = useState(params.get("teamBName") ?? "Night Owls");
  const [phase, setPhase] = useState<TxPhase | null>(null);
  // Bumped on every attempt and on Cancel, so a late wallet answer from an
  // abandoned attempt can't overwrite the current UI state.
  const attempt = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // One challenge id per form, reused until a create succeeds. The account
  // address comes from (creator, id), so a cancelled approval that lands late
  // and a retry both target the same account: never two challenges.
  const pendingId = useRef<BN | null>(null);

  const isRematch = params.get("rematchOf") !== null;

  function openChallenge(challenge: PublicKey, late: boolean) {
    pendingId.current = null;
    attempt.current++; // nothing still in flight may update this page now
    setPhase(null);
    if (late) setNotice("Your earlier request went through. Opening your challenge…");
    window.dispatchEvent(new Event("moltivate:updated"));
    router.push(`/join/${challenge.toBase58()}`);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!program || !publicKey) return; // unreachable without a connected linked wallet: the form sits inside LinkedWalletGate
    const mine = ++attempt.current;
    setPhase("approve"); // lock the button now, before the RPC lookups below
    const onPhase = (p: TxPhase) => {
      if (attempt.current === mine) setPhase(p);
    };
    setError(null);
    pendingId.current ??= new BN(Date.now());
    const challengeId = pendingId.current;
    const challenge = challengePda(publicKey, challengeId);
    try {
      // An earlier, cancelled approval may have created it since.
      if (await connection.getAccountInfo(challenge)) return openChallenge(challenge, true);

      // Always the real backend oracle (app/api/oracle/settle) -- only that
      // service's key can actually sign settle(), so there's no real
      // self-settle path for a creator-chosen oracle to support in the UI.
      if (!process.env.NEXT_PUBLIC_ORACLE_PUBKEY) {
        throw new Error("NEXT_PUBLIC_ORACLE_PUBKEY is not configured");
      }
      const oracleKey = new PublicKey(process.env.NEXT_PUBLIC_ORACLE_PUBKEY);

      const pot = potPda(publicKey, DEFAULT_GROUP_ID);
      const potAccount = await program.provider.connection.getAccountInfo(pot);
      if (!potAccount) {
        const groupTx = await program.methods
          .initializeGroup(DEFAULT_GROUP_ID)
          .accounts({ creator: publicKey })
          .transaction();
        groupTx.feePayer = publicKey;
        await sendWithPhases(connection, sendTransaction, groupTx, onPhase);
        if (attempt.current !== mine) return;
      }

      const deadlineUnix = new BN(Math.floor(Date.now() / 1000 + Number(durationDays) * 86400));

      const createTx = await program.methods
        .initialize({
          id: challengeId,
          oracle: oracleKey,
          alphaBps: HOUSE_ALPHA_PERCENT * 100,
          rakeBps: HOUSE_RAKE_PERCENT * 100,
          target: Number(goalReps),
          stakeLamports: new BN(Math.round(Number(stakeSol) * 1_000_000_000)),
          deadlineUnix,
          teamAName,
          teamBName,
        })
        // .accountsPartial(), not .accounts(): `pot` doesn't actually
        // resolve automatically at runtime here even though the generated
        // type claims it's derivable (its real seeds need the group id,
        // which isn't an `initialize` instruction arg - only an
        // `initializeGroup` one). Confirmed via a real browser run against
        // a local validator: create-challenge fails without passing it
        // explicitly. accountsPartial skips the strict "all PDAs must be
        // auto-resolvable" type check so this one can be supplied by hand.
        .accountsPartial({
          pot,
          teamA: teamPda(challenge, 0),
          teamB: teamPda(challenge, 1),
        })
        .transaction();
      createTx.feePayer = publicKey;
      await sendWithPhases(connection, sendTransaction, createTx, onPhase);
      // Landed after Cancel? Still a real challenge: say so and open it.
      openChallenge(challenge, attempt.current !== mine);
    } catch (err) {
      if (attempt.current !== mine) return;
      // A retry fails if a cancelled approval landed first; that's a success.
      if (await connection.getAccountInfo(challenge).catch(() => null)) return openChallenge(challenge, true);
      setError(describeTxError(err, program.idl.errors ?? []));
    } finally {
      if (attempt.current === mine) setPhase(null);
    }
  }

  // Cancel only stops waiting: Phantom's pending request can't be withdrawn.
  // If it's approved later, openChallenge reports it; the reused id means a
  // retry can't create a second challenge.
  function cancelApproval() {
    attempt.current++;
    setPhase(null);
  }

  return (
    <div className="app-page form-page">
      <h1 className="mb-6">{isRematch ? "Rematch" : "New challenge"}</h1>
      {isRematch && (
        <p className="mb-6 rounded-lg bg-white/[.06] p-3 text-sm text-muted">
          Prefilled from the challenge you just settled -- the group pot carries
          forward automatically since it&apos;s tied to your wallet, not to any one
          challenge. Pick a new duration and everyone rejoins via the new
          invite link, same as before.
        </p>
      )}
      <LinkedWalletGate>
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

        <Field label="Duration (days)">
          <input
            required
            type="number"
            min="0.001"
            step="0.001"
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

        {error && (
          <p className="rounded-lg bg-red-950/40 p-3 text-sm text-red-300">
            {error}
          </p>
        )}
        {notice && <p className="rounded-lg bg-accent/15 p-3 text-sm" role="status">{notice}</p>}

        <button
          type="submit"
          disabled={phase !== null}
          className="button-primary mt-2 disabled:opacity-50"
        >
          {phase === "approve"
            ? "Approve in Phantom…"
            : phase === "confirm"
              ? "Confirming on devnet…"
              : isRematch
                ? "Start rematch"
                : "Create"}
        </button>
        {phase === "approve" && (
          <p className="text-center text-xs text-muted" role="status">
            No Phantom window? Open the Phantom extension.{" "}
            <button type="button" onClick={cancelApproval} className="underline">
              Cancel
            </button>
          </p>
        )}

        <p className="text-center text-[11px] leading-relaxed text-muted">
          House rules, not yours to set: {HOUSE_ALPHA_PERCENT}% of your stake is always at
          risk even if you hit your goal, and the house takes a {HOUSE_RAKE_PERCENT}% rake
          from forfeits only (never from a winner&apos;s principal, waived entirely if both
          teams pass).
        </p>
      </form>
      </LinkedWalletGate>
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
