import { createClient } from "@supabase/supabase-js";
import { PublicKey } from "@solana/web3.js";
import { requireAccount } from "@/lib/account-auth";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { assertPublishableKey } from "@/lib/supabase-key";
import { getReadOnlyProgram } from "@/lib/server-program";
import { hasOpenStake } from "@/lib/open-stakes";
import { verifyWalletProof } from "@/lib/wallet-proof";

// Re-checks the password on a throwaway client so the cookie session is never touched. Returns null on success,
// otherwise the failure response. The password and email are never logged or echoed. The caller has already spent
// the nonce, so a failure here always means "request a new one".
async function checkPassword(email: string, password: string): Promise<Response | null> {
  const unavailable = () =>
    Response.json({ error: "could not verify your password; this request is used up, request a new one and try again" }, { status: 503 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return unavailable();
  assertPublishableKey(key);
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    // 400 is Supabase's answer for bad credentials; anything else is an outage or rate limit, not a wrong password.
    return error.status === 400 ? Response.json({ error: "incorrect password" }, { status: 401 }) : unavailable();
  }
  // The sign-in minted a server-side session nobody will use; revoke only that one (local scope), never the user's others.
  await client.auth.signOut({ scope: "local" }).catch(() => {});
  return null;
}

// Unlinks a wallet. Needs the wallet's signature over the unlink message AND the account password, and refuses while
// the wallet has an open stake or unclaimed payout. Cheap rejections (shape, signature, open stake) leave the nonce
// unspent. Before the password is tried the nonce is claimed with one atomic UPDATE, so only the single request that
// wins the claim gets a guess: a nonce allows at most one password attempt, however many requests race on it.
export async function POST(request: Request) {
  const auth = await requireAccount(request);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "wallet, nonce, signature and password required" }, { status: 400 });
  }
  const { password } = body;
  if (typeof password !== "string" || password.length === 0 || password.length > 1024) {
    return Response.json({ error: "password required" }, { status: 400 });
  }

  const proof = await verifyWalletProof(auth.account.userId, body, "unlink");
  if (!proof.ok) return proof.response;

  try {
    if (await hasOpenStake(getReadOnlyProgram(), new PublicKey(proof.wallet))) {
      return Response.json({ error: "this wallet still has an open stake or an unclaimed payout" }, { status: 409 });
    }
  } catch {
    return Response.json({ error: "could not check this wallet's stakes, try again" }, { status: 503 });
  }

  const supabase = getSupabaseServerClient();
  const { data: claimed, error: claimError } = await supabase
    .from("wallet_link_nonces")
    .update({ used_at: new Date().toISOString() })
    .eq("nonce", proof.nonce)
    .eq("user_id", auth.account.userId)
    .eq("purpose", "unlink")
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("nonce");
  if (claimError) return Response.json({ error: "could not unlink the wallet" }, { status: 500 });
  if (!claimed || claimed.length === 0) return Response.json({ error: "invalid or expired nonce" }, { status: 400 });

  const passwordFailure = await checkPassword(auth.account.email, password);
  if (passwordFailure) return passwordFailure;

  const { data: deleted, error } = await supabase
    .from("linked_wallets")
    .delete()
    .eq("wallet_address", proof.wallet)
    .eq("user_id", auth.account.userId)
    .select("wallet_address");
  if (error) return Response.json({ error: "could not unlink the wallet" }, { status: 500 });
  if (!deleted || deleted.length === 0) return Response.json({ error: "this wallet isn't linked to your account" }, { status: 409 });
  return Response.json({ wallet: proof.wallet });
}
