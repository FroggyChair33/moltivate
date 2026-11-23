import { createClient } from "@supabase/supabase-js";
import { PublicKey } from "@solana/web3.js";
import { requireAccount } from "@/lib/account-auth";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { assertPublishableKey } from "@/lib/supabase-key";
import { getReadOnlyProgram } from "@/lib/server-program";
import { hasOpenStake } from "@/lib/open-stakes";
import { verifyWalletProof } from "@/lib/wallet-proof";

// Re-checks the password on a throwaway client so the cookie session is never touched. Returns null on success,
// otherwise the failure response. The password and email are never logged or echoed.
async function checkPassword(email: string, password: string, burn: () => Promise<boolean>): Promise<Response | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return Response.json({ error: "could not verify your password" }, { status: 503 });
  assertPublishableKey(key);
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    // 400 is Supabase's answer for bad credentials; anything else is an outage or rate limit, not a wrong password.
    if (error.status === 400) {
      // A wrong guess burns the nonce, so each nonce allows exactly one guess (the nonce route rate-limits issuing them).
      if (!(await burn())) return Response.json({ error: "could not verify your password, try again" }, { status: 503 });
      return Response.json({ error: "incorrect password" }, { status: 401 });
    }
    return Response.json({ error: "could not verify your password, try again" }, { status: error.status === 429 ? 429 : 503 });
  }
  // The sign-in minted a server-side session nobody will use; revoke only that one (local scope), never the user's others.
  await client.auth.signOut({ scope: "local" }).catch(() => {});
  return null;
}

// Unlinks a wallet. Needs the wallet's signature over the unlink message AND the account password, and refuses while
// the wallet has an open stake or unclaimed payout. The nonce is consumed by the final RPC, or earlier by a wrong
// password; an open stake or a bad signature leaves it usable.
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

  // The wallet signature comes before the password so the password check is not reachable without the wallet key, and a wrong guess burns the nonce.
  const proof = await verifyWalletProof(auth.account.userId, body, "unlink");
  if (!proof.ok) return proof.response;

  const burn = async () => {
    const { error } = await getSupabaseServerClient()
      .from("wallet_link_nonces")
      .update({ used_at: new Date().toISOString() })
      .eq("nonce", proof.nonce)
      .eq("user_id", auth.account.userId)
      .is("used_at", null);
    return !error;
  };
  const passwordFailure = await checkPassword(auth.account.email, password, burn);
  if (passwordFailure) return passwordFailure;

  try {
    if (await hasOpenStake(getReadOnlyProgram(), new PublicKey(proof.wallet))) {
      return Response.json({ error: "this wallet still has an open stake or an unclaimed payout" }, { status: 409 });
    }
  } catch {
    return Response.json({ error: "could not check this wallet's stakes, try again" }, { status: 503 });
  }

  const { data, error } = await getSupabaseServerClient().rpc("unlink_wallet", {
    p_nonce: proof.nonce,
    p_user: auth.account.userId,
    p_wallet: proof.wallet,
  });
  if (error) return Response.json({ error: "could not unlink the wallet" }, { status: 500 });
  if (data === "unlinked") return Response.json({ wallet: proof.wallet });
  if (data === "not_linked") return Response.json({ error: "this wallet isn't linked to your account" }, { status: 409 });
  return Response.json({ error: "invalid or expired nonce" }, { status: 400 });
}
