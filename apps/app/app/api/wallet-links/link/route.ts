import { requireAccount } from "@/lib/account-auth";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { verifyWalletProof } from "@/lib/wallet-proof";

// Links a wallet to the signed-in account once the wallet has signed the server-issued link message.
export async function POST(request: Request) {
  const auth = await requireAccount(request);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "wallet, nonce and signature required" }, { status: 400 });
  }

  const proof = await verifyWalletProof(auth.account.userId, body, "link");
  if (!proof.ok) return proof.response;

  const { data, error } = await getSupabaseServerClient().rpc("link_wallet", {
    p_nonce: proof.nonce,
    p_user: auth.account.userId,
    p_wallet: proof.wallet,
  });
  if (error) return Response.json({ error: "could not link the wallet" }, { status: 500 });
  if (data === "linked") return Response.json({ wallet: proof.wallet });
  if (data === "taken") return Response.json({ error: "this wallet can't be linked to your account" }, { status: 409 });
  return Response.json({ error: "invalid or expired nonce" }, { status: 400 });
}
