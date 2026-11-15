import { JoinClient } from "./join-client";

// Reads `params` client-side (wallet-adapter calls can't run server-side),
// so this can't produce a static shell under Cache Components.
export const instant = false;

// `code` is the challenge account's own base58 address -- the client
// component fetches that real on-chain Challenge/Team state directly.
export default async function JoinPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <JoinClient code={code} />;
}
