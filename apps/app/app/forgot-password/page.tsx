"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { createBrowserAuthClient } from "@/lib/supabase-browser";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error: resetError } = await createBrowserAuthClient().auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
      });
      if (resetError) setError("Could not send the email right now. Try again later.");
      else setSent(true);
    } catch {
      setError("Could not send the email right now. Try again later.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-page form-page max-w-md">
      <h1>Reset your password</h1>
      {sent ? (
        // The same answer whether or not the address has an account.
        <p role="status" className="page-intro">If an account uses that email, we&apos;ve sent it a link to set a new password. Open it on this device.</p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Email</span>
            <input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input" />
          </label>
          {error && <p role="alert" className="rounded-lg bg-red-950/40 p-3 text-sm text-red-300">{error}</p>}
          <button type="submit" disabled={busy} className="button-primary disabled:opacity-50">{busy ? "Sending…" : "Send reset link"}</button>
        </form>
      )}
      <p className="mt-5 text-sm"><Link href="/login" className="underline">Back to log in</Link></p>
    </div>
  );
}
