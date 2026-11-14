"use client";

import { useMemo } from "react";
import type { Program } from "@coral-xyz/anchor";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { getProgram } from "./anchor";
import type { CommitmentStakes } from "./idl/commitment_stakes";

// null until a wallet is connected -- every call site must handle that.
export function useProgram(): Program<CommitmentStakes> | null {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  return useMemo(() => (wallet ? getProgram(connection, wallet) : null), [connection, wallet]);
}
