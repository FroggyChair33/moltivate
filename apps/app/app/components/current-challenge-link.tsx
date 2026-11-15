"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useProgram } from "@/lib/use-program";
import { fetchMemberships } from "@/lib/anchor";

// Links to the scoreboard of every not-yet-settled challenge the connected
// wallet has joined. There's no on-chain index of "my challenges" -- this
// is a getProgramAccounts filter on owner, then a settled check per
// result. A wallet can genuinely be in more than one at once.
export function CurrentChallengeLink() {
  const { publicKey } = useWallet();
  const program = useProgram();
  const [challenges, setChallenges] = useState<string[]>([]);

  useEffect(() => {
    // Nothing to reset here when disconnected -- the component renders
    // null in that case anyway (see below).
    if (!program || !publicKey) return;
    let cancelled = false;
    (async () => {
      const memberships = await fetchMemberships(program, publicKey);
      const settledFlags = await Promise.all(
        memberships.map((m) => program.account.challenge.fetch(m.account.challenge).then((c) => c.settled)),
      );
      const unsettled = memberships.filter((_, i) => !settledFlags[i]).map((m) => m.account.challenge.toBase58());
      if (!cancelled) setChallenges(unsettled);
    })();
    return () => {
      cancelled = true;
    };
  }, [program, publicKey]);

  if (!publicKey || challenges.length === 0) return null;

  if (challenges.length === 1) {
    return (
      <Link href={`/challenges/${challenges[0]}`} className="hover:underline">
        Your challenge
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-muted">Your challenges:</span>
      {challenges.map((id, i) => (
        <Link key={id} href={`/challenges/${id}`} className="hover:underline">
          {i + 1}
        </Link>
      ))}
    </div>
  );
}
