import { randomBytes } from "crypto";
import { requireAccount } from "@/lib/account-auth";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { isPurpose, parseWallet, walletMessage } from "@/lib/wallet-proof";

const NONCE_TTL_SECONDS = 5 * 60;
const MAX_OUTSTANDING = 10;
// An unlink nonce allows one password guess (a wrong password consumes it), so the number of unlink nonces an account
// can request is what bounds password guessing. There is no created_at column: expires_at is created + 5 minutes, so
// rows created in the last 15 minutes are those with expires_at after now - 10 minutes. Used rows count.
const MAX_UNLINK_PER_WINDOW = 5;
const UNLINK_WINDOW_SECONDS = 15 * 60;

// Issues a single-use nonce and the exact message the wallet must sign. The link/unlink routes rebuild that message
// from the stored row, so what the client signs is what the server verifies.
export async function POST(request: Request) {
  const auth = await requireAccount(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const walletPk = parseWallet(body?.wallet);
  if (!walletPk || !isPurpose(body?.purpose)) {
    return Response.json({ error: 'wallet must be a valid pubkey and purpose must be "link" or "unlink"' }, { status: 400 });
  }
  const purpose = body.purpose;
  const wallet = walletPk.toBase58();
  const accountId = auth.account.userId;
  const supabase = getSupabaseServerClient();

  // Not atomic with the insert, so a burst of parallel requests can overshoot slightly; nonces still expire in 5 minutes.
  const { count, error: countError } = await supabase
    .from("wallet_link_nonces")
    .select("nonce", { count: "exact", head: true })
    .eq("user_id", accountId)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString());
  if (countError) return Response.json({ error: "could not issue a nonce" }, { status: 500 });
  if ((count ?? 0) >= MAX_OUTSTANDING) {
    return Response.json({ error: "too many outstanding requests, wait a few minutes" }, { status: 429 });
  }

  if (purpose === "unlink") {
    const since = new Date(Date.now() - (UNLINK_WINDOW_SECONDS - NONCE_TTL_SECONDS) * 1000).toISOString();
    const { count: recent, error: recentError } = await supabase
      .from("wallet_link_nonces")
      .select("nonce", { count: "exact", head: true })
      .eq("user_id", accountId)
      .eq("purpose", "unlink")
      .gt("expires_at", since);
    if (recentError) return Response.json({ error: "could not issue a nonce" }, { status: 500 });
    if ((recent ?? 0) >= MAX_UNLINK_PER_WINDOW) {
      return Response.json({ error: "too many unlink attempts, try again in a few minutes" }, { status: 429 });
    }
  }

  const nonce = randomBytes(32).toString("base64url");
  const expiresAt = Math.floor(Date.now() / 1000) + NONCE_TTL_SECONDS;
  const { error } = await supabase.from("wallet_link_nonces").insert({
    nonce,
    user_id: accountId,
    wallet_address: wallet,
    purpose,
    expires_at: new Date(expiresAt * 1000).toISOString(),
  });
  if (error) return Response.json({ error: "could not issue a nonce" }, { status: 500 });

  return Response.json({ nonce, expiresAt, message: walletMessage(purpose, { accountId, wallet, nonce, expiresAt }) });
}
