// Server-only: the oracle's own signing key, never exposed to the client.
// See AGENTS.md "Keep backend database credentials, settlement signer
// material, and service secrets out of the mobile bundle and repository."
import "server-only";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, clusterApiUrl, type Transaction, type VersionedTransaction } from "@solana/web3.js";
import idl from "./idl/commitment_stakes.json";
import type { CommitmentStakes } from "./idl/commitment_stakes";

class KeypairWallet {
  constructor(public payer: Keypair) {}
  get publicKey() {
    return this.payer.publicKey;
  }
  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if ("version" in tx) {
      tx.sign([this.payer]);
    } else {
      tx.partialSign(this.payer);
    }
    return tx;
  }
  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
    return Promise.all(txs.map((tx) => this.signTransaction(tx)));
  }
}

export function getOracleKeypair(): Keypair {
  const raw = process.env.ORACLE_SECRET_KEY;
  if (!raw) throw new Error("ORACLE_SECRET_KEY is not set");
  const bytes = Uint8Array.from(JSON.parse(raw));
  return Keypair.fromSecretKey(bytes);
}

export function getOracleProgram(): Program<CommitmentStakes> {
  const endpoint = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || clusterApiUrl("devnet");
  const connection = new Connection(endpoint, "confirmed");
  const provider = new AnchorProvider(connection, new KeypairWallet(getOracleKeypair()), {
    commitment: "confirmed",
  });
  return new Program(idl as CommitmentStakes, provider);
}
