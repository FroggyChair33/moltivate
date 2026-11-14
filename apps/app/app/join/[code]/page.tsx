import { JoinClient } from "./join-client";

// Reads `params` and will fetch a real invite/challenge row later -- can't
// produce a static shell under Cache Components.
export const instant = false;

// Join-by-link stub. `code` would look up a real challenge/invite row via an
// API route; the client component below just renders the mocked challenge
// regardless of code.
export default async function JoinPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <JoinClient code={code} />;
}
