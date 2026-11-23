import { getSupabaseServerClient } from "./supabase-server";

// Wallets this account has proven it controls. Always read fresh (no caching): link state can change at any time.
export async function getLinkedWallets(userId: string): Promise<string[]> {
  const { data, error } = await getSupabaseServerClient().from("linked_wallets").select("wallet_address").eq("user_id", userId);
  if (error) throw new Error(`linked_wallets read failed: ${error.message}`);
  return (data ?? []).map((row) => row.wallet_address);
}
