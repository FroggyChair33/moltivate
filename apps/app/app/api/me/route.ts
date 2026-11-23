import { connection } from "next/server";
import { requireAccount } from "@/lib/account-auth";
import { getLinkedWallets } from "@/lib/linked-wallets";
import { ensureProfile, getDisplayName } from "@/lib/profile";
import { getSupabaseServerClient } from "@/lib/supabase-server";

// The signed-in account's own details. The only route that returns an email, and only the caller's own.
export async function GET(request: Request) {
  await connection(); // per-request: never prerender an auth-dependent response
  const auth = await requireAccount(request);
  if (!auth.ok) return auth.response;
  const { userId, email } = auth.account;

  try {
    let displayName = await getDisplayName(userId);
    if (displayName === null) {
      // First visit (or no usable name yet): try the sign-up metadata. It is untrusted; ensureProfile validates it,
      // and if the lookup fails we carry on without it.
      let metadataName: unknown = null;
      try {
        const { data } = await getSupabaseServerClient().auth.admin.getUserById(userId);
        metadataName = data?.user?.user_metadata?.display_name;
      } catch {
        metadataName = null;
      }
      displayName = (await ensureProfile(userId, metadataName)).displayName;
    }
    const wallets = await getLinkedWallets(userId);
    return Response.json({ email, displayName, needsDisplayName: displayName === null, wallets });
  } catch {
    return Response.json({ error: "could not load your account" }, { status: 500 });
  }
}
