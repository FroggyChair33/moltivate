import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { displayNameMessage } from "@/lib/display-name-message";

// Batch display-name lookup, e.g. GET /api/users?wallets=addr1,addr2.
// Read-only, no auth needed -- display names are public once set.
export async function GET(request: Request) {
  const wallets = new URL(request.url).searchParams.get("wallets");
  if (!wallets) {
    return NextResponse.json({ error: "wallets query param required" }, { status: 400 });
  }

  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("users")
      .select("wallet_address, display_name")
      .in("wallet_address", wallets.split(",").filter(Boolean));

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const names: Record<string, string> = {};
    for (const row of data ?? []) {
      if (row.display_name) names[row.wallet_address] = row.display_name;
    }
    return NextResponse.json({ names });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

// Sets the connected wallet's own display name. A supplied wallet address
// alone is not authentication (see AGENTS.md) -- this requires a signature
// over the exact wallet+name pair being set, proving the caller actually
// holds that wallet's key, not just that they typed its address.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (
    !body ||
    typeof body.wallet !== "string" ||
    typeof body.displayName !== "string" ||
    typeof body.signature !== "string" ||
    body.displayName.length < 1 ||
    body.displayName.length > 80
  ) {
    return NextResponse.json({ error: "invalid request: wallet, displayName (1-80 chars), signature required" }, { status: 400 });
  }

  let walletPk: PublicKey;
  try {
    walletPk = new PublicKey(body.wallet);
  } catch {
    return NextResponse.json({ error: "wallet must be a valid pubkey" }, { status: 400 });
  }

  const message = new TextEncoder().encode(displayNameMessage(body.wallet, body.displayName));
  try {
    // nacl.sign.detached.verify throws (not a clean `false`) on a
    // malformed signature, e.g. the wrong byte length -- confirmed by
    // testing a garbage value, which crashed this route with an uncaught
    // exception before this was wrapped. Base64-decoding a bad string can
    // also throw, hence both are inside this one try.
    const signatureBytes = Buffer.from(body.signature, "base64");
    const verified = nacl.sign.detached.verify(message, signatureBytes, walletPk.toBytes());
    if (!verified) {
      return NextResponse.json({ error: "signature does not match wallet and display name" }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: "malformed signature" }, { status: 400 });
  }

  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase
      .from("users")
      .upsert({ wallet_address: body.wallet, display_name: body.displayName }, { onConflict: "wallet_address" });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ status: "ok" });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
