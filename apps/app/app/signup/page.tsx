"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { safeNextPath } from "@/lib/safe-next-path";
import { createBrowserAuthClient } from "@/lib/supabase-browser";
import { normalizeDisplayName } from "@/lib/display-name";
import { isNeutralAuthError } from "@/lib/auth-errors";

const MIN_PASSWORD = 12;

// useSearchParams() needs a Suspense boundary under the App Router.
export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}

function SignupForm() {
  // Where to land after confirming the email (an invite, for example); /auth/callback applies safeNextPath again.
  const next = safeNextPath(useSearchParams().get("next"));
  const loginHref = next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`;
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const parsed = normalizeDisplayName(displayName);
    if (!parsed.ok) return setError(parsed.error);
    if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters for your password.`);
    setBusy(true);
    try {
      const res = await fetch(`/api/profile/name-available?name=${encodeURIComponent(parsed.name)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError("Could not check that display name right now. Try again.");
      if (!data.available) return setError(data.error ?? "That display name is taken. Pick another.");

      const { error: signUpError } = await createBrowserAuthClient().auth.signUp({
        email,
        password,
        options: { data: { display_name: parsed.name }, emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
      });
      // Every server answer except weak_password shows "check your email", so sign-up never reveals who has an account.
      if (!isNeutralAuthError(signUpError, "signup")) {
        return setError(signUpError?.code === "weak_password"
          ? "That password is too weak or has appeared in a data breach. Choose another."
          : "Could not reach the server. Check your connection and try again.");
      }
      setPassword("");
      setSent(true);
    } catch {
      setError("Could not create the account right now. Try again later.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="app-page form-page max-w-md">
        <h1>Check your email</h1>
        <p role="status" className="page-intro">
          If that address can be used, we&apos;ve sent it a link to confirm your account. Open it on this device to finish signing up.
        </p>
        <Link href={loginHref} className="underline">Back to log in</Link>
      </div>
    );
  }

  return (
    <div className="app-page form-page max-w-md">
      <h1>Create an account</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Display name</span>
          <input required maxLength={40} autoComplete="nickname" value={displayName}
            onChange={(e) => setDisplayName(e.target.value)} className="input" aria-describedby="name-help" />
          <span id="name-help" className="text-xs text-muted">Shown to your teammates. 1-40 letters, numbers, spaces, dots, dashes or underscores.</span>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Email</span>
          <input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Password</span>
          <input required type="password" autoComplete="new-password" minLength={MIN_PASSWORD} value={password}
            onChange={(e) => setPassword(e.target.value)} className="input" aria-describedby="password-help" />
          <span id="password-help" className="text-xs text-muted">At least {MIN_PASSWORD} characters.</span>
        </label>
        {error && <p role="alert" className="rounded-lg bg-red-950/40 p-3 text-sm text-red-300">{error}</p>}
        <button type="submit" disabled={busy} className="button-primary disabled:opacity-50">{busy ? "Creating…" : "Create account"}</button>
        <p className="text-sm">Already have an account? <Link href={loginHref} className="underline">Log in</Link></p>
      </form>
    </div>
  );
}
