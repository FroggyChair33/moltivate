import { ResultsClient } from "./client";

// Same reasoning as app/challenges/[id]/page.tsx -- reads `params`, fetches
// real on-chain data client-side, can't produce a static shell.
export const instant = false;

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ResultsClient id={id} />;
}
