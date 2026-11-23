// Messages a wallet signs to link to / unlink from an account. The first line differs so a
// signature for one action can never verify for the other.
export type WalletProof = { accountId: string; wallet: string; nonce: string; expiresAt: number }; // expiresAt: unix seconds

const body = (action: string, p: WalletProof) =>
  [
    `Moltivate: ${action}`,
    `Account: ${p.accountId}`,
    `Wallet: ${p.wallet}`,
    `Nonce: ${p.nonce}`,
    `Expires: ${new Date(p.expiresAt * 1000).toISOString()}`,
  ].join("\n");

export const linkWalletMessage = (p: WalletProof) => body("link this wallet to your account", p);
export const unlinkWalletMessage = (p: WalletProof) => body("unlink this wallet from your account", p);
