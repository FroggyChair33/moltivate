"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { displayNameMessage } from "@/lib/display-name-message";

// Lets the connected wallet set its own display name, shown across the app
// in place of a truncated address. The signature step is what stops anyone
// from setting a name on a wallet they don't hold -- see app/api/users's
// comment and AGENTS.md "a supplied wallet address alone is not
// authentication".
export function DisplayNameEditor() {
  const { publicKey, signMessage } = useWallet();
  const [currentName, setCurrentName] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Nothing to reset when disconnected -- the component renders null in
    // that case anyway (see below), so there's no stale name left visible.
    if (!publicKey) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/users?wallets=${publicKey.toBase58()}`);
      const data = await res.json().catch(() => ({}));
      if (!cancelled) setCurrentName(data.names?.[publicKey.toBase58()] ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  if (!publicKey) return null;

  async function handleSave() {
    if (!publicKey || !signMessage) return;
    const name = draft.trim();
    if (name.length < 1 || name.length > 80) {
      setError("Name must be 1-80 characters.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const wallet = publicKey.toBase58();
      const message = new TextEncoder().encode(displayNameMessage(wallet, name));
      const signature = await signMessage(message);
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet,
          displayName: name,
          signature: Buffer.from(signature).toString("base64"),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setCurrentName(name);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (!signMessage) {
    // Wallet is connected but this adapter doesn't support message signing --
    // no safe way to prove ownership, so skip offering the feature at all
    // rather than falling back to an unauthenticated name-set.
    return null;
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(currentName ?? "");
          setEditing(true);
        }}
        className="text-xs text-muted hover:underline"
      >
        {currentName ?? "Set a display name"}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Your name"
        maxLength={80}
        className="input h-8 w-32 text-xs"
      />
      <button
        type="button"
        disabled={saving}
        onClick={handleSave}
        className="rounded-full bg-foreground px-3 py-1 text-xs font-medium text-background disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save"}
      </button>
      <button type="button" onClick={() => setEditing(false)} className="text-xs text-muted">
        Cancel
      </button>
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
