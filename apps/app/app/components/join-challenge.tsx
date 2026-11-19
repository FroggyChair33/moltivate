"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PublicKey } from "@solana/web3.js";

export function JoinChallenge() {
  const router = useRouter();
  const [invite, setInvite] = useState("");
  const [error, setError] = useState("");
  return <form className="paper-panel space-y-3" onSubmit={(event) => {
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
    <h2 className="text-xl">Join with an invite</h2>
    <label htmlFor="challenge-invite" className="block text-sm">Challenge address or invite link</label>
    <input id="challenge-invite" className="input w-full" value={invite} onChange={(event) => setInvite(event.target.value)} required aria-describedby={error ? "invite-error" : undefined} />
    {error && <p id="invite-error" role="alert" className="text-sm text-red-700">{error}</p>}
    <button className="button-primary" type="submit">Review invitation</button>
  </form>;
}
