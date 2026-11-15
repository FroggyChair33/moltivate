// Devnet only -- see AGENTS.md "Financial correctness": mainnet/real funds
// require a separately requested, reviewed release. Matches the hardcoded
// devnet cluster in app/providers.tsx.
export function explorerTxUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}
