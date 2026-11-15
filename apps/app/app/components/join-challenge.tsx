"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PublicKey } from "@solana/web3.js";

export function JoinChallenge() {
  const router = useRouter();
  const [invite, setInvite] = useState("");
  const [error, setError] = useState("");
  return <form className="space-y-3 rounded-2xl border border-line p-5" onSubmit={(event) => {
    event.preventDefault();
    try {
      const value = invite.trim();
      const code = value.includes("://") ? new URL(value).pathname.split("/").filter(Boolean).at(-1)! : value;
      new PublicKey(code);
      router.push("/join/" + code);
    } catch {
      setError("Paste a valid challenge address or invite link.");
    }
  }}>
    <h2 className="text-2xl">Got an invite?</h2>
    <label htmlFor="challenge-invite" className="block text-sm">Challenge address or invite link</label>
    <input id="challenge-invite" className="input w-full" value={invite} onChange={(event) => setInvite(event.target.value)} required aria-describedby={error ? "invite-error" : undefined} />
    {error && <p id="invite-error" role="alert" className="text-sm text-red-700">{error}</p>}
    <button className="rounded-full border border-foreground px-5 py-3 font-medium" type="submit">Review invitation</button>
  </form>;
}
