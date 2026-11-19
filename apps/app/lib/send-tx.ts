import type { Connection, Transaction } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";

// "approve": waiting for the user to approve in Phantom (nothing sent yet).
// "confirm": sent; waiting for devnet to confirm it.
export type TxPhase = "approve" | "confirm";

type ProgramError = { code: number; name: string; msg: string };

// Anchor's .rpc() used to turn program errors into named AnchorErrors; going
// through the wallet's sendTransaction loses that, leaving either an on-chain
// `{"Custom":6008}` or a simulation `custom program error: 0x1778`. Map either
// back to the IDL's name and message; anything else is returned unchanged.
export function describeTxError(err: unknown, errors: ProgramError[]): string {
  const message =
    typeof err === "object" && err !== null && "message" in err ? String((err as { message: unknown }).message) : String(err);
  const match = message.match(/"Custom":(\d+)/) ?? message.match(/custom program error: (0x[0-9a-f]+)/i);
  const code = match ? Number(match[1]) : NaN;
  const known = errors.find((e) => e.code === code);
  return known ? `${known.name}: ${known.msg}` : message;
}

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
