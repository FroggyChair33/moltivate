// Shared checks for the link and unlink routes: validate the request fields, find the stored nonce, rebuild the
// message the server issued and verify the wallet's signature over it. Nothing here consumes the nonce (the link
// route's link_wallet SQL function and the unlink route's atomic claim UPDATE do), so any rejection here leaves it reusable.
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import { linkWalletMessage, unlinkWalletMessage, type WalletProof } from "./wallet-link-message";
import { getSupabaseServerClient } from "./supabase-server";

export type Purpose = "link" | "unlink";
const reject = (status: number, error: string) => Response.json({ error }, { status });

// Fields are validated before they are interpolated into a signed message (the builders do no escaping).
const NONCE_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]{1,128}={0,2}$/;

export const isPurpose = (value: unknown): value is Purpose => value === "link" || value === "unlink";

export function parseWallet(value: unknown): PublicKey | null {
  if (typeof value !== "string") return null;
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

export const walletMessage = (purpose: Purpose, proof: WalletProof) =>
  purpose === "link" ? linkWalletMessage(proof) : unlinkWalletMessage(proof);

// body is the parsed JSON; accountId is always the authenticated session's, never from the body.
export async function verifyWalletProof(
  accountId: string,
  body: Record<string, unknown>,
  purpose: Purpose,
): Promise<{ ok: true; wallet: string; nonce: string } | { ok: false; response: Response }> {
  const { nonce, signature } = body;
  const walletPk = parseWallet(body.wallet);
  if (!walletPk || typeof nonce !== "string" || !NONCE_PATTERN.test(nonce) || typeof signature !== "string" || !BASE64_PATTERN.test(signature)) {
    return { ok: false, response: reject(400, "wallet, nonce and signature are required and must be well-formed") };
  }
  const wallet = walletPk.toBase58();

  // The wallet and expiry come from the stored row, not the client, and the row must belong to this account and purpose.
  const { data: row, error } = await getSupabaseServerClient()
    .from("wallet_link_nonces")
    .select("wallet_address, expires_at, used_at")
    .eq("nonce", nonce)
    .eq("user_id", accountId)
    .eq("purpose", purpose)
    .maybeSingle();
  if (error) return { ok: false, response: reject(500, "could not check the nonce") };
  const expiresMs = row ? Date.parse(row.expires_at) : NaN;
  if (!row || row.used_at !== null || row.wallet_address !== wallet || !(expiresMs > Date.now())) {
    return { ok: false, response: reject(400, "invalid or expired nonce") };
  }

  const message = new TextEncoder().encode(walletMessage(purpose, { accountId, wallet, nonce, expiresAt: Math.floor(expiresMs / 1000) }));
  try {
    // verify throws on a wrong-length signature, hence the try.
    if (!nacl.sign.detached.verify(message, Buffer.from(signature, "base64"), walletPk.toBytes())) {
      return { ok: false, response: reject(401, "signature does not match this wallet and message") };
    }
  } catch {
    return { ok: false, response: reject(400, "malformed signature") };
  }
  return { ok: true, wallet, nonce };
}
