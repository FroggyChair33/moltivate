// Server-only, read-only program client -- never signs or sends anything,
// so a disposable throwaway keypair is fine. Used by routes that only need
// to fetch real on-chain state server-side (e.g. confirming a challenge is
// actually settled and fully claimed before app/api/challenges/close
// accepts a dismissal), as opposed to lib/oracle.ts's real signing key.
import "server-only";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, clusterApiUrl, type Transaction, type VersionedTransaction } from "@solana/web3.js";
import idl from "./idl/commitment_stakes.json";
import type { CommitmentStakes } from "./idl/commitment_stakes";

class ReadOnlyWallet {
  constructor(public payer: Keypair) {}
  get publicKey() {
    return this.payer.publicKey;
  }
  async signTransaction<T extends Transaction | VersionedTransaction>(): Promise<T> {
    throw new Error("ReadOnlyWallet cannot sign -- this client is for fetching account state only");
  }
  async signAllTransactions<T extends Transaction | VersionedTransaction>(): Promise<T[]> {
    throw new Error("ReadOnlyWallet cannot sign -- this client is for fetching account state only");
  }
}

export function getReadOnlyProgram(): Program<CommitmentStakes> {
  const endpoint = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || clusterApiUrl("devnet");
  const connection = new Connection(endpoint, "confirmed");
  const provider = new AnchorProvider(connection, new ReadOnlyWallet(Keypair.generate()), {
    commitment: "confirmed",
  });
  return new Program(idl as CommitmentStakes, provider);
}
