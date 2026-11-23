"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserAuthClient } from "@/lib/supabase-browser";
import { safeNextPath } from "@/lib/safe-next-path";
import { useAccount } from "@/app/components/account-provider";

// useSearchParams() needs a Suspense boundary under the App Router.
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { refresh } = useAccount();
  const next = safeNextPath(params.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  // Set when the password is accepted but the account has a verified TOTP factor still to pass.
  const [factorId, setFactorId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get("error") ? "That link is invalid or has expired. Try again." : null);

  // A session left at password-only level (e.g. the page was reloaded mid-login) goes straight to the code step.
  useEffect(() => {
    void (async () => {
      try {
        const factor = await pendingTotpFactor();
        if (factor) setFactorId(factor);
      } catch {
        // Not configured or no session: stay on the password step.
      }
    })();
  }, []);

  async function finish() {
    await refresh();
    router.replace(next);
  }

  async function handlePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const auth = createBrowserAuthClient().auth;
      const { error: signInError } = await auth.signInWithPassword({ email, password });
      if (signInError) {
        // Only reachable with the right password, so it reveals nothing about who is registered.
        setError(signInError.code === "email_not_confirmed"
          ? "Verify your email first: open the link we sent you."
          : "Email or password is incorrect.");
        return;
      }
      setPassword("");
      const factor = await pendingTotpFactor();
      if (factor) setFactorId(factor);
      else await finish();
    } catch {
      setError("Could not sign in right now. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!factorId) return;
    setBusy(true);
    setError(null);
    try {
      const mfa = createBrowserAuthClient().auth.mfa;
      const { data: challenge, error: challengeError } = await mfa.challenge({ factorId });
      if (challengeError || !challenge) throw challengeError;
      const { error: verifyError } = await mfa.verify({ factorId, challengeId: challenge.id, code: code.trim() });
      if (verifyError) {
        setError("That code didn't work. Check your authenticator app and try again.");
        return;
      }
      await finish();
    } catch {
      setError("Could not check the code right now. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-page form-page max-w-md">
      <h1>Log in</h1>
      {factorId ? (
        <form onSubmit={handleCode} className="flex flex-col gap-5" aria-describedby="code-help">
          <p id="code-help" className="text-sm text-muted">Enter the 6-digit code from your authenticator app.</p>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Code</span>
            <input required autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}
              value={code} onChange={(e) => setCode(e.target.value)} className="input" />
          </label>
          {error && <p role="alert" className="rounded-lg bg-red-950/40 p-3 text-sm text-red-300">{error}</p>}
          <button type="submit" disabled={busy} className="button-primary disabled:opacity-50">{busy ? "Checking…" : "Verify"}</button>
        </form>
      ) : (
        <form onSubmit={handlePassword} className="flex flex-col gap-5">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Email</span>
            <input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Password</span>
            <input required type="password" autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)} className="input" />
          </label>
          {error && <p role="alert" className="rounded-lg bg-red-950/40 p-3 text-sm text-red-300">{error}</p>}
          <button type="submit" disabled={busy} className="button-primary disabled:opacity-50">{busy ? "Signing in…" : "Log in"}</button>
          <p className="flex flex-wrap justify-between gap-3 text-sm">
            <Link href="/forgot-password" className="underline">Forgot password?</Link>
            <Link href="/signup" className="underline">Create an account</Link>
          </p>
        </form>
      )}
    </div>
  );
}

// The verified TOTP factor to pass, if the current session still needs one (aal1 now, aal2 possible).
async function pendingTotpFactor(): Promise<string | null> {
  const mfa = createBrowserAuthClient().auth.mfa;
  const { data: aal } = await mfa.getAuthenticatorAssuranceLevel();
  if (!aal || aal.currentLevel !== "aal1" || aal.nextLevel !== "aal2") return null;
  const { data } = await mfa.listFactors();
  return data?.totp[0]?.id ?? null;
}
