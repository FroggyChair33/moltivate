"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useProgram } from "@/lib/use-program";
import { fetchWalletChallenges } from "@/lib/anchor";

type Challenge = Awaited<ReturnType<typeof fetchWalletChallenges>>[number];

export function CurrentChallengeLink() {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58();
  return wallet ? <ChallengeList key={wallet} /> : (
    <div className="rounded-xl border border-dashed border-line p-5"><p className="text-sm font-medium">Your next chapter starts here.</p><p className="mt-2 text-sm leading-relaxed text-muted">Connect your Solana wallet to find your teams, progress, and results.</p></div>
  );
}

function ChallengeList() {
  const { publicKey } = useWallet();
  const program = useProgram();
  const pathname = usePathname();
  const [challenges, setChallenges] = useState<Challenge[] | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!program || !publicKey) return;
    let cancelled = false;
    let loading = false;
    async function refresh() {
      if (loading || document.visibilityState === "hidden") return;
      loading = true;
      try {
        const entries = await fetchWalletChallenges(program!, publicKey!);
        const closed = new Set<string>();
        // Bound URL size while respecting existing global UI dismissals.
        for (let start = 0; start < entries.length; start += 20) {
          const ids = entries.slice(start, start + 20).map((entry) => entry.id);
          const response = await fetch("/api/challenges/close?challenges=" + ids.join(","));
          if (!response.ok) throw new Error("Could not refresh dismissed challenges. Please retry.");
          const data = await response.json();
          for (const id of data.closed ?? []) closed.add(id);
        }
        if (!cancelled) {
          setChallenges(entries.filter((entry) => !closed.has(entry.id) || entry.claimPending));
          setError("");
        }
      } catch {
        if (!cancelled) setError("Your challenges could not be refreshed. Your last loaded results are shown.");
      } finally {
        loading = false;
      }
    }
    void refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("moltivate:updated", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("moltivate:updated", refresh);
    };
  }, [program, publicKey, pathname, revision]);

  return (
    <div className="space-y-5" aria-live="polite">
      {error && <div role="alert" className="rounded-xl border border-accent p-4">
        <p>{error}</p>
        <button type="button" className="mt-2 underline" onClick={() => setRevision((value) => value + 1)}>Retry</button>
      </div>}
      {!challenges && !error && <p className="text-muted">Loading your devnet challenges…</p>}
      {challenges?.length === 0 && <p className="text-muted">Your next commitment starts here. Create a challenge or open a teammate’s invite.</p>}
      {[false, true].map((settled) => {
        const entries = challenges?.filter((entry) => entry.settled === settled) ?? [];
        if (!entries.length) return null;
        return <section key={String(settled)} className="space-y-3">
          <h3 className="text-xl">{settled ? "Results" : "Active challenges"}</h3>
          {entries.map((entry) => <Link key={entry.id}
            href={`/challenges/${entry.id}${entry.settled ? "/results" : ""}`}
            className="block rounded-2xl border border-line bg-white/60 p-5 hover:border-foreground">
            <span className="block font-medium">{entry.claimPending ? "Claim pending" : entry.settled ? "View results" : "Open challenge"}</span>
            <span className="mt-1 block break-all text-xs text-muted">{entry.id}</span>
            <span className="mt-2 block text-sm">{entry.creator ? "Created by you" : "Your team"} · Devnet</span>
          </Link>)}
        </section>;
      })}
    </div>
  );
}
