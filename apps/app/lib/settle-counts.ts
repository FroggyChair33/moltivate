export const U32_MAX = 4_294_967_295;

// Total reps for one member, clamped to u32 because the program's settle()
// takes Vec<u32>: an unclamped sum would fail to encode and block settlement
// (and so every stake in the challenge) forever. Clamping changes no payout,
// since the program caps each member at 150% of their goal, itself a u32.
export function memberCount(rows: { reps: number }[]): number {
  return Math.min(rows.reduce((sum, row) => sum + row.reps, 0), U32_MAX);
}
