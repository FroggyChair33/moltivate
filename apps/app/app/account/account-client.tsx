"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { createBrowserAuthClient } from "@/lib/supabase-browser";
import { normalizeDisplayName } from "@/lib/display-name";
import { AccountLoadError, useAccount } from "@/app/components/account-provider";
import { WalletButton, isPhoneWithoutWallet } from "@/app/components/wallet-button";

const MIN_PASSWORD = 12;
const shorten = (wallet: string) => `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
const errorText = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong. Try again.");
const notifyUpdated = () => window.dispatchEvent(new Event("moltivate:updated"));

function Msg({ error, ok }: { error?: string | null; ok?: string | null }) {
  if (error) return <p role="alert" className="rounded-lg bg-red-950/40 p-3 text-sm text-red-300">{error}</p>;
  if (ok) return <p role="status" className="text-sm text-muted">{ok}</p>;
  return null;
}

type Reply = { ok: boolean; status: number; error: string | null; nonce?: string; message?: string };

async function postJson(path: string, body: unknown): Promise<Reply> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return {
    ok: res.ok,
    status: res.status,
    error: typeof data?.error === "string" ? data.error : null,
    nonce: typeof data?.nonce === "string" ? data.nonce : undefined,
    message: typeof data?.message === "string" ? data.message : undefined,
  };
}

// Wallet-link API failures in plain words, matched on the exact error texts in app/api/wallet-links/unlink/route.ts.
// Every other failure (signature mismatch, expired session, ...) shows the server's own text.
function linkFailure(status: number, serverError: string | null): string {
  if (status === 401 && serverError === "incorrect password") return "That password is incorrect.";
  if (status === 429) return "Too many attempts. Wait a few minutes and try again.";
  if (status === 503 && serverError?.startsWith("could not verify your password")) {
    return "Couldn't verify your password right now (sign-in may be busy or rate-limited). Wait a minute and try again.";
  }
  if (status === 503 && serverError?.startsWith("could not check this wallet's stakes")) {
    return "Couldn't check this wallet's stakes right now. Nothing was changed; try again.";
  }
  if (status === 409) return serverError ?? "This wallet has an open stake or an unclaimed payout, or can't be linked.";
  return serverError ?? "Something went wrong. Try again.";
}

type SignMessage = (message: Uint8Array) => Promise<Uint8Array>;

// nonce -> the wallet signs the server's exact message string -> { nonce, signature (base64) }.
async function requestSignature(wallet: string, purpose: "link" | "unlink", signMessage: SignMessage) {
  const res = await postJson("/api/wallet-links/nonce", { wallet, purpose });
  if (!res.ok || !res.nonce || !res.message) throw new Error(linkFailure(res.status, res.error));
  let signature: Uint8Array;
  try {
    signature = await signMessage(new TextEncoder().encode(res.message));
  } catch {
    throw new Error("The wallet didn't sign the message. Approve it in your wallet and try again.");
  }
  return { nonce: res.nonce, signature: btoa(String.fromCharCode(...signature)) };
}

export function AccountClient() {
  const { status, me } = useAccount();
  if (status === "error") return <div className="app-page form-page max-w-md"><h1>Account</h1><AccountLoadError /></div>;
  if (status === "signedOut") {
    return <div className="app-page form-page max-w-md"><h1>Account</h1><p><Link href="/login" className="underline">Log in</Link> to see your account.</p></div>;
  }
  if (!me) return <div className="app-page form-page max-w-md"><h1>Account</h1><p role="status" className="text-muted">Loading…</p></div>;
  return (
    <div className="app-page form-page max-w-md flex flex-col gap-8">
      <h1>Account</h1>
      <section className="paper-panel flex flex-col gap-1">
        <span className="text-sm font-medium">Email</span>
        <span className="text-sm text-muted break-all">{me.email}</span>
      </section>
      <NameSection initial={me.displayName ?? ""} />
      <WalletsSection wallets={me.wallets} />
      <PasswordSection />
      <MfaSection />
      <SignOutSection />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="paper-panel flex flex-col gap-4"><h2>{title}</h2>{children}</section>;
}

function NameSection({ initial }: { initial: string }) {
  const { refresh } = useAccount();
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setOk(null);
    const parsed = normalizeDisplayName(name);
    if (!parsed.ok) return setError(parsed.error);
    setBusy(true);
    try {
      const res = await postJson("/api/profile", { displayName: parsed.name });
      if (res.status === 409) return setError("That display name is taken. Pick another.");
      if (!res.ok) return setError(res.status === 400 ? (res.error ?? "That name isn't allowed.") : "Could not save the name right now. Try again.");
      await refresh();
      notifyUpdated();
      setOk("Name saved.");
    } catch {
      setError("Could not save the name right now. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Display name">
      <form onSubmit={save} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Shown to teammates</span>
          <input required maxLength={40} autoComplete="nickname" value={name} onChange={(e) => setName(e.target.value)} className="input" />
        </label>
        <Msg error={error} ok={ok} />
        <button type="submit" disabled={busy} className="button-primary disabled:opacity-50">{busy ? "Saving…" : "Save name"}</button>
      </form>
    </Section>
  );
}

function WalletsSection({ wallets }: { wallets: string[] }) {
  const { refresh } = useAccount();
  const { publicKey, signMessage } = useWallet();
  const connected = publicKey?.toBase58() ?? null;
  const [phone, setPhone] = useState(false);
  const [unlinking, setUnlinking] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    // Browser-only check (user agent), so it can't run during render without a hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPhone(isPhoneWithoutWallet());
  }, []);

  async function done(message: string) {
    setOk(message);
    await refresh();
    notifyUpdated();
  }

  async function link() {
    if (!connected || !signMessage) return;
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const { nonce, signature } = await requestSignature(connected, "link", signMessage);
      const res = await postJson("/api/wallet-links/link", { wallet: connected, nonce, signature });
      if (!res.ok) throw new Error(linkFailure(res.status, res.error));
      await done("Wallet linked.");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function unlink(event: FormEvent<HTMLFormElement>, wallet: string) {
    event.preventDefault();
    if (connected !== wallet || !signMessage) return setError(`Connect ${shorten(wallet)} in your wallet first; it has to sign the unlink request.`);
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const { nonce, signature } = await requestSignature(wallet, "unlink", signMessage);
      const res = await postJson("/api/wallet-links/unlink", { wallet, nonce, signature, password });
      if (!res.ok) throw new Error(linkFailure(res.status, res.error));
      setUnlinking(null);
      await done("Wallet unlinked.");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPassword("");
      setBusy(false);
    }
  }

  return (
    <Section title="Wallets">
      {wallets.length === 0 && <p className="text-sm text-muted">No wallet linked yet. Link one to join and stake on challenges.</p>}
      <ul className="flex flex-col gap-3">
        {wallets.map((wallet) => (
          <li key={wallet} className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-sm" title={wallet}>{shorten(wallet)}</span>
              <button type="button" disabled={busy} className="text-sm underline disabled:opacity-50"
                onClick={() => { setUnlinking(unlinking === wallet ? null : wallet); setPassword(""); setError(null); setOk(null); }}>
                {unlinking === wallet ? "Cancel" : "Unlink"}
              </button>
            </div>
            {unlinking === wallet && (
              <form onSubmit={(e) => unlink(e, wallet)} className="flex flex-col gap-4">
                <p className="text-sm text-muted">
                  Enter your account password, then approve the signature in your wallet.
                  {connected !== wallet && ` ${shorten(wallet)} must be the connected wallet.`}
                </p>
                {connected !== wallet && <WalletConnect phone={phone} />}
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">Password</span>
                  <input required type="password" autoComplete="current-password" value={password}
                    onChange={(e) => setPassword(e.target.value)} className="input" />
                </label>
                <button type="submit" disabled={busy} className="button-primary disabled:opacity-50">{busy ? "Unlinking…" : "Unlink wallet"}</button>
              </form>
            )}
          </li>
        ))}
      </ul>
      {connected && !wallets.includes(connected) && (
        signMessage ? (
          <button type="button" onClick={link} disabled={busy} className="button-primary disabled:opacity-50">
            {busy ? "Waiting for wallet…" : `Link connected wallet (${shorten(connected)})`}
          </button>
        ) : <p className="text-sm text-muted">This wallet can&apos;t sign messages, so it can&apos;t be linked.</p>
      )}
      {!connected && unlinking === null && <WalletConnect phone={phone} />}
      <Msg error={error} ok={ok} />
    </Section>
  );
}

function WalletConnect({ phone }: { phone: boolean }) {
  if (phone) {
    return <p className="text-sm text-muted">Linking a wallet needs a desktop browser with Phantom installed. Phone wallet connect doesn&apos;t work yet.</p>;
  }
  return <div><WalletButton /></div>;
}

function PasswordSection() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setOk(null);
    if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters.`);
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    try {
      const { error: updateError } = await createBrowserAuthClient().auth.updateUser({ password });
      if (updateError) return setError(updateError.message);
      setPassword("");
      setConfirm("");
      setOk("Password changed.");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Change password">
      <form onSubmit={save} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">New password</span>
          <input required type="password" autoComplete="new-password" minLength={MIN_PASSWORD} value={password}
            onChange={(e) => setPassword(e.target.value)} className="input" aria-describedby="pw-help" />
          <span id="pw-help" className="text-xs text-muted">At least {MIN_PASSWORD} characters.</span>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Confirm new password</span>
          <input required type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="input" />
        </label>
        <Msg error={error} ok={ok} />
        <button type="submit" disabled={busy} className="button-primary disabled:opacity-50">{busy ? "Saving…" : "Change password"}</button>
      </form>
    </Section>
  );
}

type Enrollment = { factorId: string; qr: string; secret: string };

// Optional authenticator-app (TOTP) sign-in step.
function MfaSection() {
  const [factors, setFactors] = useState<{ id: string }[]>([]);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await createBrowserAuthClient().auth.mfa.listFactors();
      setFactors(data?.totp ?? []); // `totp` holds verified factors only
    } catch {
      // Not configured: the section just shows no factors.
    }
  }, []);
  useEffect(() => {
    // Initial fetch of external state; the setState happens after the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function start() {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const mfa = createBrowserAuthClient().auth.mfa;
      // An abandoned enrolment leaves an unverified factor that would block a new one with the same name.
      const { data: existing } = await mfa.listFactors();
      for (const f of existing?.all ?? []) {
        if (f.factor_type === "totp" && f.status === "unverified") await mfa.unenroll({ factorId: f.id });
      }
      const { data, error: enrollError } = await mfa.enroll({ factorType: "totp" });
      if (enrollError || !data) return setError(enrollError?.message ?? "Could not start setup. Try again.");
      setEnrollment({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enrollment) return;
    setBusy(true);
    setError(null);
    try {
      const mfa = createBrowserAuthClient().auth.mfa;
      const { data: challenge, error: challengeError } = await mfa.challenge({ factorId: enrollment.factorId });
      if (challengeError || !challenge) return setError(challengeError?.message ?? "Could not check the code. Try again.");
      const { error: verifyError } = await mfa.verify({ factorId: enrollment.factorId, challengeId: challenge.id, code: code.trim() });
      if (verifyError) return setError("That code didn't work. Check your authenticator app and try again.");
      setEnrollment(null);
      setCode("");
      setOk("Authenticator app added. You'll be asked for a code when you log in.");
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(factorId: string) {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      // May need a session that already passed the code step (aal2); the error text says so if not.
      const { error: unenrollError } = await createBrowserAuthClient().auth.mfa.unenroll({ factorId });
      if (unenrollError) return setError(unenrollError.message);
      setOk("Authenticator app removed.");
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    if (enrollment) void createBrowserAuthClient().auth.mfa.unenroll({ factorId: enrollment.factorId }).catch(() => {});
    setEnrollment(null);
    setCode("");
    setError(null);
  }

  return (
    <Section title="Authenticator app (optional)">
      <p className="text-sm text-muted">Adds a 6-digit code from an authenticator app to logging in.</p>
      {factors.map((f, i) => (
        <div key={f.id} className="flex items-center justify-between gap-3 text-sm">
          <span>Authenticator app{factors.length > 1 ? ` ${i + 1}` : ""}</span>
          <button type="button" disabled={busy} onClick={() => remove(f.id)} className="underline disabled:opacity-50">Remove</button>
        </div>
      ))}
      {enrollment ? (
        <form onSubmit={confirm} className="flex flex-col gap-4">
          <p className="text-sm text-muted">Scan this with your authenticator app, or enter the secret by hand, then type the 6-digit code it shows.</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- data: URI from Supabase, nothing to optimize */}
          <img src={enrollment.qr} alt="QR code for your authenticator app" width={192} height={192} className="rounded-lg bg-white p-2" />
          <p className="text-xs text-muted break-all">Secret: <code>{enrollment.secret}</code></p>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Code</span>
            <input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}
              value={code} onChange={(e) => setCode(e.target.value)} className="input" />
          </label>
          <Msg error={error} ok={ok} />
          <button type="submit" disabled={busy} className="button-primary disabled:opacity-50">{busy ? "Checking…" : "Confirm"}</button>
          <button type="button" disabled={busy} onClick={cancel} className="text-sm underline disabled:opacity-50">Cancel</button>
        </form>
      ) : (
        <>
          <Msg error={error} ok={ok} />
          {factors.length === 0 && (
            <button type="button" onClick={start} disabled={busy} className="button-primary disabled:opacity-50">{busy ? "Starting…" : "Set up authenticator app"}</button>
          )}
        </>
      )}
    </Section>
  );
}

function SignOutSection() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut(scope: "local" | "global") {
    setBusy(true);
    setError(null);
    try {
      const { error: signOutError } = await createBrowserAuthClient().auth.signOut({ scope });
      if (signOutError) return setError(signOutError.message);
      notifyUpdated();
      router.replace("/login");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Sign out">
      <Msg error={error} />
      <button type="button" disabled={busy} onClick={() => signOut("local")} className="button-primary disabled:opacity-50">Log out</button>
      <button type="button" disabled={busy} onClick={() => signOut("global")} className="text-sm underline disabled:opacity-50">Log out of all devices</button>
    </Section>
  );
}
