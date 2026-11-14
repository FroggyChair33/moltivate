import { ChallengeScoreboardClient } from "./client";

// Reads `params` and fetches real on-chain data client-side (wallet-adapter
// calls can't run server-side), so this can't produce a static shell under
// Cache Components; allow it to block instead of prerendering.
export const instant = false;

// `id` is the challenge account's own base58 address.
export default async function ChallengeScoreboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ChallengeScoreboardClient id={id} />;
}
