// Shared client for the commitment-stakes Anchor program. The IDL here is
// a committed copy of programs/commitment-stakes/idl/commitment_stakes.json
// -- re-copy it whenever the program changes (see AGENTS.md: "Keep API
// schemas, generated contract types, and scoring rules synchronized").
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import { PublicKey, type Connection } from "@solana/web3.js";
import idl from "./idl/commitment_stakes.json";
import type { CommitmentStakes } from "./idl/commitment_stakes";

export const PROGRAM_ID = new PublicKey(idl.address);

// One persistent group pot per creator wallet, shared across all of that
// creator's challenges -- see lib.rs's InitializeGroup. The scaffold never
// needs more than one, so it's a fixed id rather than something a user picks.
export const DEFAULT_GROUP_ID = new BN(0);

export function getProgram(connection: Connection, wallet: AnchorWallet): Program<CommitmentStakes> {
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  return new Program(idl as CommitmentStakes, provider);
}

export function challengePda(creator: PublicKey, challengeId: BN): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("challenge"), creator.toBuffer(), challengeId.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID,
  );
  return pda;
}

export function vaultPda(challenge: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from("vault"), challenge.toBuffer()], PROGRAM_ID);
  return pda;
}

export function treasuryPda(challenge: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from("treasury"), challenge.toBuffer()], PROGRAM_ID);
  return pda;
}

export function potPda(creator: PublicKey, groupId: BN = DEFAULT_GROUP_ID): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pot"), creator.toBuffer(), groupId.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID,
  );
  return pda;
}

export function teamPda(challenge: PublicKey, index: 0 | 1): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("team"), challenge.toBuffer(), Buffer.from([index])],
    PROGRAM_ID,
  );
  return pda;
}

export function memberPda(challenge: PublicKey, owner: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("member"), challenge.toBuffer(), owner.toBuffer()],
    PROGRAM_ID,
  );
  return pda;
}

// All TeamMember accounts for one challenge. There's no on-chain list of
// members (seeds depend on the member's own wallet, which isn't knowable in
// advance), so this is a getProgramAccounts filter instead: byte 8 is where
// the `challenge` field starts, right after the 8-byte Anchor discriminator.
export async function fetchChallengeMembers(program: Program<CommitmentStakes>, challenge: PublicKey) {
  return program.account.teamMember.all([{ memcmp: { offset: 8, bytes: challenge.toBase58() } }]);
}

// All TeamMember accounts owned by one wallet, across every challenge --
// same idea as fetchChallengeMembers but filtered on `owner` instead of
// `challenge`. Byte 72 is where `owner` starts: discriminator (8) +
// challenge (32) + team (32).
export async function fetchMemberships(program: Program<CommitmentStakes>, owner: PublicKey) {
  return program.account.teamMember.all([{ memcmp: { offset: 72, bytes: owner.toBase58() } }]);
}

// Challenge.creator is the first field after its eight-byte discriminator.
// Anchor's account namespace retains the account-type discriminator filter.
export async function fetchWalletChallenges(program: Program<CommitmentStakes>, owner: PublicKey) {
  const [created, memberships] = await Promise.all([
    program.account.challenge.all([{ memcmp: { offset: 8, bytes: owner.toBase58() } }]),
    fetchMemberships(program, owner),
  ]);
  const challenges = new Map(created.map((entry) => [entry.publicKey.toBase58(), entry]));
  const joinedIds = [...new Set(memberships.map((entry) => entry.account.challenge.toBase58()))];
  const missing = joinedIds.filter((id) => !challenges.has(id));
  const accounts = await program.account.challenge.fetchMultiple(missing.map((id) => new PublicKey(id)));
  accounts.forEach((account, index) => {
    if (account) challenges.set(missing[index], { publicKey: new PublicKey(missing[index]), account });
  });
  return [...challenges.values()].map((entry) => ({
    id: entry.publicKey.toBase58(),
    settled: entry.account.settled,
    creator: entry.account.creator.equals(owner),
    claimPending: entry.account.settled && memberships.some((member) =>
      member.account.challenge.equals(entry.publicKey) && !member.account.claimed),
  }));
}

export const NO_WINNER = 2;
