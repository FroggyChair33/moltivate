"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { AccountLoadError, useAccount } from "@/app/components/account-provider";
import { fetchWalletChallenges, getReadProgram, mergeWalletChallenges, type WalletChallenge } from "@/lib/anchor";

// Challenges follow the account's linked wallets, so no connected wallet is needed (works on a phone).
export function CurrentChallengeLink() {
  const { me, status } = useAccount();
  const wallets = me?.wallets ?? [];
  if (status === "loading") return <p className="text-muted">Loading your account…</p>;
  if (status === "error") return <AccountLoadError />;
  return wallets.length ? <ChallengeList key={wallets.join(",")} wallets={wallets} /> : (
    <div className="rounded-xl border border-dashed border-line p-5"><p className="text-sm font-medium">Your next chapter starts here.</p><p className="mt-2 text-sm leading-relaxed text-muted"><Link href="/account" className="underline">Link a wallet on the Account page</Link> to see your challenges.</p></div>
  );
}

function ChallengeList({ wallets }: { wallets: string[] }) {
  const { connection } = useConnection();
  const program = useMemo(() => getReadProgram(connection), [connection]);
  const walletKey = wallets.join(",");
  const pathname = usePathname();
  const [challenges, setChallenges] = useState<WalletChallenge[] | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let loading = false;
    async function refresh() {
      if (loading || document.visibilityState === "hidden") return;
      loading = true;
      try {
        const entries = mergeWalletChallenges(await Promise.all(walletKey.split(",").map((wallet) => fetchWalletChallenges(program, new PublicKey(wallet)))));
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
  }, [program, walletKey, pathname, revision]);

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
            className="block rounded-2xl border border-line bg-surface p-5 hover:border-accent">
            <span className="block font-medium">{entry.claimPending ? "Claim pending" : entry.settled ? "View results" : "Open challenge"}</span>
            <span className="mt-1 block break-all text-xs text-muted">{entry.id}</span>
            <span className="mt-2 block text-sm">{entry.creator ? "Created by you" : "Your team"} · Devnet</span>
          </Link>)}
        </section>;
      })}
    </div>
  );
}
