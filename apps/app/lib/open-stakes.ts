import { PublicKey } from "@solana/web3.js";
import type { Program } from "@coral-xyz/anchor";
import type { CommitmentStakes } from "./idl/commitment_stakes";
import { fetchMemberships } from "./anchor";

// True while this wallet still has money tied up: it is a member of an unsettled challenge, or of a settled one it
// has not claimed from. Fails closed: a membership whose challenge account cannot be fetched counts as open, so a
// flaky or partial RPC read can never let someone unlink a wallet that still has a payout waiting.
export async function hasOpenStake(program: Program<CommitmentStakes>, wallet: PublicKey): Promise<boolean> {
  const memberships = await fetchMemberships(program, wallet);
  if (memberships.length === 0) return false;
  const ids = [...new Set(memberships.map((m) => m.account.challenge.toBase58()))];
  const challenges = await program.account.challenge.fetchMultiple(ids.map((id) => new PublicKey(id)));
  const settled = new Map(ids.map((id, i) => [id, challenges[i]?.settled === true]));
  return memberships.some((m) => !settled.get(m.account.challenge.toBase58()) || !m.account.claimed);
}
