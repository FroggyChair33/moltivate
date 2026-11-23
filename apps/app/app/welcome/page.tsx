"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { normalizeDisplayName } from "@/lib/display-name";
import { useAccount } from "@/app/components/account-provider";

// For a signed-in account without a usable display name (AccountProvider sends it here).
export default function WelcomePage() {
  const router = useRouter();
  const { me, refresh } = useAccount();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (me && !me.needsDisplayName) router.replace("/");
  }, [me, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const parsed = normalizeDisplayName(name);
    if (!parsed.ok) return setError(parsed.error);
    setBusy(true);
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: parsed.name }),
      });
      if (res.status === 409) return setError("That display name is taken. Pick another.");
      if (!res.ok) return setError("Could not save the name right now. Try again.");
      await refresh(); // needsDisplayName becomes false, and the effect above moves on
    } catch {
      setError("Could not save the name right now. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-page form-page max-w-md">
      <h1>Choose a display name</h1>
      <p className="page-intro">Your teammates see this name next to your reps.</p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Display name</span>
          <input required autoFocus maxLength={40} autoComplete="nickname" value={name}
            onChange={(e) => setName(e.target.value)} className="input" aria-describedby="name-help" />
          <span id="name-help" className="text-xs text-muted">1-40 letters, numbers, spaces, dots, dashes or underscores.</span>
        </label>
        {error && <p role="alert" className="rounded-lg bg-red-950/40 p-3 text-sm text-red-300">{error}</p>}
        <button type="submit" disabled={busy} className="button-primary disabled:opacity-50">{busy ? "Saving…" : "Save name"}</button>
      </form>
    </div>
  );
}
