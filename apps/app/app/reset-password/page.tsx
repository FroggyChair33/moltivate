"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserAuthClient } from "@/lib/supabase-browser";
import { useAccount } from "@/app/components/account-provider";

const MIN_PASSWORD = 12;

// Reached from the emailed link: /auth/callback has already turned it into a session.
export default function ResetPasswordPage() {
  const router = useRouter();
  const { refresh } = useAccount();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters.`);
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    try {
      const auth = createBrowserAuthClient().auth;
      const { data } = await auth.getSession();
      if (!data.session) return setError("This reset link has expired. Request a new one.");
      const { error: updateError } = await auth.updateUser({ password });
      if (updateError) {
        return setError(updateError.code === "weak_password"
          ? "That password is too weak or has appeared in a data breach. Choose another."
          : updateError.code === "same_password"
            ? "Choose a password different from your current one."
            : "Could not update the password. If you use two-step verification, log in with your code first.");
      }
      await refresh();
      router.replace("/");
    } catch {
      setError("Could not update the password right now. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-page form-page max-w-md">
      <h1>Set a new password</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">New password</span>
          <input required type="password" autoComplete="new-password" minLength={MIN_PASSWORD} value={password}
            onChange={(e) => setPassword(e.target.value)} className="input" aria-describedby="password-help" />
          <span id="password-help" className="text-xs text-muted">At least {MIN_PASSWORD} characters.</span>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Confirm new password</span>
          <input required type="password" autoComplete="new-password" minLength={MIN_PASSWORD} value={confirm}
            onChange={(e) => setConfirm(e.target.value)} className="input" />
        </label>
        {error && <p role="alert" className="rounded-lg bg-red-950/40 p-3 text-sm text-red-300">{error}</p>}
        <button type="submit" disabled={busy} className="button-primary disabled:opacity-50">{busy ? "Saving…" : "Save password"}</button>
        <p className="text-sm"><Link href="/forgot-password" className="underline">Request a new link</Link></p>
      </form>
    </div>
  );
}
