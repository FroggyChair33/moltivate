import type { Connection, Transaction } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";

// "approve": waiting for the user to approve in Phantom (nothing sent yet).
// "confirm": sent; waiting for devnet to confirm it.
export type TxPhase = "approve" | "confirm";

// Like Anchor's .rpc(), but reports which of the two waits the user is in, so
// the UI can tell "approve in your wallet" apart from "confirming on chain".
export async function sendWithPhases(
  connection: Connection,
  sendTransaction: WalletContextState["sendTransaction"],
  tx: Transaction,
  onPhase: (phase: TxPhase) => void,
): Promise<string> {
  onPhase("approve");
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  const signature = await sendTransaction(tx, connection);
  onPhase("confirm");
  const result = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  if (result.value.err) {
    throw new Error("transaction failed on chain: " + JSON.stringify(result.value.err));
  }
  return signature;
}
